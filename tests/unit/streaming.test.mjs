import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConversationEngine,
  FileConversationStore,
  createChatHandler,
} from '@pagesquire/server';
import {
  AssistantClient,
  createHttpTransport,
  en,
} from '../../packages/client/dist/index.js';

const fixture = JSON.parse(
  await readFile(
    new URL('../fixtures/conformance.json', import.meta.url),
    'utf8',
  ),
);
const origin = 'https://example.test';
const csrfToken = 'a'.repeat(48);
const session = {
  key: 'stream-session',
  principal: 'member',
  csrfToken,
  capabilityIds: ['testing.set'],
};
const lines = async (response) =>
  (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
function chat(headers = {}) {
  return new Request(`${origin}/chat`, {
    method: 'POST',
    headers: {
      origin,
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken,
      Accept: 'application/x-ndjson, application/json;q=0.9',
      ...headers,
    },
    body: JSON.stringify(fixture.request),
  });
}
async function handler(t, provider) {
  const directory = await realpath(
    await mkdtemp(join(await realpath(tmpdir()), 'pagesquire-stream-')),
  );
  t.after(() => rm(directory, { recursive: true }));
  return createChatHandler({
    origin,
    store: new FileConversationStore(directory),
    authorize: async () => session,
    engine: new ConversationEngine({ manifest: fixture.manifest, provider }),
  });
}

test('Node streams fixed stages, then the validated reply, only after every check passed', async (t) => {
  const handle = await handler(t, {
    async complete() {
      return structuredClone(fixture.drafts.final);
    },
  });
  const response = await handle(chat());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  const events = await lines(response);
  assert.deepEqual(
    events.map((event) =>
      event.type === 'progress' ? event.stage : event.type,
    ),
    ['accepted', 'thinking', 'reply'],
  );
  assert.equal(events.at(-1).reply.response.text, 'Verified.');
  const denied = await handle(chat({ origin: 'https://attacker.test' }));
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get('content-type'), /application\/json/);
  const plain = await handle(chat({ Accept: 'application/json' }));
  assert.match(plain.headers.get('content-type'), /application\/json/);
});

test('Node streams provider failures as a final error line without model text', async (t) => {
  const handle = await handler(t, {
    async complete() {
      throw new Error('secret provider detail');
    },
  });
  const events = await lines(await handle(chat()));
  const last = events.at(-1);
  assert.deepEqual(last, {
    type: 'error',
    status: 502,
    error: {
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'The assistant provider is unavailable. Start a new conversation or try again later.',
    },
  });
  assert.doesNotMatch(JSON.stringify(events), /secret provider detail/);
});

const reply = {
  protocolVersion: '0.1',
  conversationId: 'conversation',
  response: {
    protocolVersion: '0.1',
    text: 'Done.',
    emotion: 'happy',
    finished: true,
    toolCalls: [],
  },
};
/** A response whose body arrives in arbitrary chunks, splitting lines. */
function ndjson(text, chunk = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += chunk)
          controller.enqueue(bytes.slice(index, index + chunk));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } },
  );
}
const transport = (body, extra = {}) => {
  const sent = [];
  return {
    sent,
    run: createHttpTransport({
      locale: 'en',
      endpoint: '/chat',
      baseUrl: `${origin}/`,
      csrfToken: () => csrfToken,
      fetch: async (url, init) => {
        sent.push(init.headers.Accept);
        return typeof body === 'function' ? body() : ndjson(body);
      },
      ...extra,
    }),
  };
};
const line = (event) => `${JSON.stringify(event)}\n`;

test('the client transport reads split NDJSON lines, reports stages and returns the reply', async () => {
  const stages = [];
  const { run, sent } = transport(
    line({ type: 'progress', stage: 'accepted' }) +
      line({ type: 'progress', stage: 'thinking' }) +
      line({ type: 'progress', stage: 'model text must not pass' }) +
      line({ type: 'future', data: 1 }) +
      line({ type: 'reply', reply }),
  );
  const result = await run({}, new AbortController().signal, (stage) =>
    stages.push(stage),
  );
  assert.deepEqual(result, reply);
  assert.deepEqual(stages, ['accepted', 'thinking']);
  assert.match(sent[0], /application\/x-ndjson/);
  const plain = transport(line({ type: 'reply', reply }), { stream: false });
  await plain.run({}, new AbortController().signal);
  assert.equal(plain.sent[0], 'application/json');
});

test('streamed errors use allowlisted codes and localized copy; broken streams fail closed', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    transport(
      line({ type: 'progress', stage: 'accepted' }) +
        line({
          type: 'error',
          status: 429,
          error: { code: 'BUDGET_EXHAUSTED', message: '<img onerror=x>' },
        }),
    ).run({}, signal),
    (error) =>
      error.code === 'HTTP_429' && error.message === en['error.http429'],
  );
  await assert.rejects(
    transport(
      line({
        type: 'error',
        status: 502,
        error: { code: 'PROVIDER_UNAVAILABLE', message: 'x' },
      }),
    ).run({}, signal),
    { code: 'PROVIDER_UNAVAILABLE', message: en['error.http502'] },
  );
  for (const body of [
    line({ type: 'progress', stage: 'accepted' }),
    'not json\n',
    `${'x'.repeat(270000)}\n`,
  ])
    await assert.rejects(transport(body).run({}, signal), {
      code: 'INVALID_RESPONSE',
    });
});

test('the client exposes the server stage while waiting and clears it afterwards', async () => {
  let release;
  const seen = [];
  const client = new AssistantClient({
    locale: 'en',
    runtime: {
      observe: () => ({
        protocolVersion: '0.1',
        id: 'snapshot',
        url: `${origin}/`,
        title: '',
        text: '',
        targets: [],
        truncated: { text: false, targets: false },
      }),
      registry: { list: () => [] },
      resetSession() {},
    },
    transport: async (request, signal, onProgress) => {
      onProgress('accepted');
      onProgress('thinking');
      await new Promise((resolve) => (release = resolve));
      return reply;
    },
  });
  client.subscribe((state) => seen.push(state.serverStage));
  const sending = client.send('Hello');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.state.serverStage, 'thinking');
  release();
  await sending;
  assert.equal(client.state.serverStage, undefined);
  assert.ok(seen.includes('accepted') && seen.includes('thinking'));
  assert.equal(client.state.messages.at(-1).text, 'Done.');
});
