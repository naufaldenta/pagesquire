import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ConversationEngine,
  FileConversationStore,
  OpenAiCompatibleProvider,
  createChatHandler,
  readBounded,
} from '@pagesquire/server';
const fixture = JSON.parse(
  await readFile(
    new URL('../fixtures/conformance.json', import.meta.url),
    'utf8',
  ),
);
const origin = 'https://example.test';
const csrfToken = 'a'.repeat(48);
const session = {
  key: 'trusted-session',
  principal: 'member-1:revision-1',
  csrfToken,
  capabilityIds: ['testing.set'],
};
function request(body = fixture.request, headers = {}) {
  return new Request(origin + '/chat', {
    method: 'POST',
    headers: {
      origin,
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
async function temporary(t) {
  const parent = await realpath(tmpdir());
  const directory = await realpath(
    await mkdtemp(join(parent, 'pagesquire-server-test-')),
  );
  t.after(async () => {
    assert.equal(resolve(directory, '..'), parent);
    assert.ok(
      directory.split(/[\\/]/).at(-1).startsWith('pagesquire-server-test-'),
    );
    await rm(directory, { recursive: true });
  });
  return directory;
}
test('Node endpoint defaults deny, checks origin/CSRF/content type and does not expose host errors', async (t) => {
  const directory = await temporary(t);
  let calls = 0;
  const engine = new ConversationEngine({
    manifest: fixture.manifest,
    provider: {
      async complete() {
        calls++;
        return fixture.drafts.final;
      },
    },
  });
  const store = new FileConversationStore(directory);
  const create = (authorize) =>
    createChatHandler({ engine, store, origin, authorize });
  assert.equal((await create(async () => null)(request())).status, 403);
  const handler = create(async () => session);
  for (const [headers, status] of [
    [{ origin: 'https://attacker.test' }, 403],
    [{ 'X-CSRF-TOKEN': '' }, 419],
    [{ 'Content-Type': 'text/plain' }, 415],
    [{ 'content-encoding': 'gzip' }, 415],
  ])
    assert.equal((await handler(request(undefined, headers))).status, status);
  assert.equal((await handler(new Request(origin + '/chat'))).status, 405);
  assert.equal(calls, 0);
  const failed = await create(async () => {
    throw new Error('private-secret');
  })(request());
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /private-secret/);
  const accepted = await handler(request());
  assert.equal(accepted.status, 200);
  assert.match(accepted.headers.get('cache-control'), /no-store/);
  const internal = new Request('http://internal-proxy/chat', {
    method: 'POST',
    headers: request().headers,
    body: JSON.stringify({ ...fixture.request, requestId: 'proxy-request' }),
  });
  assert.equal((await handler(internal)).status, 200);
});
test('Node durable state survives a new adapter and preserves charged failures and replay denial', async (t) => {
  const directory = await temporary(t);
  let calls = 0;
  const engine = new ConversationEngine({
    manifest: fixture.manifest,
    provider: {
      async complete() {
        calls++;
        throw new Error('secret');
      },
    },
  });
  const create = () =>
    createChatHandler({
      engine,
      store: new FileConversationStore(directory),
      origin,
      authorize: async () => session,
    });
  assert.equal((await create()(request())).status, 502);
  assert.equal((await create()(request())).status, 409);
  assert.equal(calls, 1);
  await new FileConversationStore(directory).transaction(
    session.key,
    async (tx) => {
      const saved = await tx.load();
      assert.equal(saved.state.attempts, 1);
      assert.equal(saved.rate.count, 2);
    },
  );
});
test('Node exact retry caches proposals; changed principal and revoked authorization cannot continue them', async (t) => {
  const directory = await temporary(t);
  let authorized = session;
  let calls = 0;
  const engine = new ConversationEngine({
    manifest: fixture.manifest,
    provider: {
      async complete() {
        calls++;
        return fixture.drafts.action;
      },
    },
  });
  const handler = createChatHandler({
    engine,
    store: new FileConversationStore(directory),
    origin,
    authorize: async () => authorized,
  });
  const first = await (await handler(request())).json();
  assert.deepEqual(await (await handler(request())).json(), first);
  assert.equal(calls, 1);
  authorized = { ...session, capabilityIds: [] };
  assert.equal((await handler(request())).status, 403);
  authorized = { ...session, principal: 'another-user' };
  assert.equal(
    (
      await handler(
        request({
          ...fixture.request,
          requestId: 'later',
          conversationId: first.conversationId,
        }),
      )
    ).status,
    409,
  );
});
test('Node transaction serialization fails closed and rate limit survives identity changes', async (t) => {
  const directory = await temporary(t);
  const store = new FileConversationStore(directory);
  await store.transaction('lock', async () => {
    await assert.rejects(
      store.transaction('lock', async () => {}),
      { code: 'BUSY' },
    );
  });
  let principal = session.principal;
  const handler = createChatHandler({
    origin,
    store,
    requestsPerMinute: 1,
    authorize: async () => ({ ...session, principal }),
    engine: new ConversationEngine({
      manifest: fixture.manifest,
      provider: {
        async complete() {
          return fixture.drafts.final;
        },
      },
    }),
  });
  assert.equal((await handler(request())).status, 200);
  principal = 'other';
  const response = await handler(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
});
test('Node session provider budget survives new conversations and identity changes', async (t) => {
  const directory = await temporary(t);
  let calls = 0;
  let principal = session.principal;
  const handler = createChatHandler({
    origin,
    store: new FileConversationStore(directory),
    attemptsPerHour: 2,
    authorize: async () => ({ ...session, principal }),
    engine: new ConversationEngine({
      manifest: fixture.manifest,
      provider: {
        async complete() {
          calls++;
          return fixture.drafts.final;
        },
      },
    }),
  });
  const fresh = (id) => request({ ...fixture.request, requestId: id });
  assert.equal((await handler(fresh('budget-1'))).status, 200);
  principal = 'other';
  assert.equal((await handler(fresh('budget-2'))).status, 200);
  const exhausted = await handler(fresh('budget-3'));
  assert.equal(exhausted.status, 429);
  assert.equal((await exhausted.json()).error.code, 'BUDGET_EXHAUSTED');
  assert.equal(calls, 2);
  assert.throws(
    () =>
      createChatHandler({
        origin,
        store: new FileConversationStore(directory),
        attemptsPerHour: 0,
        authorize: async () => session,
        engine: new ConversationEngine({
          manifest: fixture.manifest,
          provider: { async complete() {} },
        }),
      }),
    { code: 'INVALID_OPTIONS' },
  );
});
test('Node rejects oversized streamed input without trusting Content-Length', async () => {
  await assert.rejects(
    readBounded(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(10));
            controller.close();
          },
        }),
      ),
      9,
    ),
    { code: 'REQUEST_TOO_LARGE' },
  );
});
test('Node trusted catalog fails closed on duplicate IDs, unbounded limits, async schemas and unknown formats', () => {
  const options = {
    manifest: fixture.manifest,
    provider: { async complete() {} },
  };
  assert.throws(() => new ConversationEngine({ ...options, maxSteps: 0 }), {
    code: 'INVALID_LIMITS',
  });
  assert.throws(
    () =>
      new ConversationEngine({
        ...options,
        manifest: {
          ...fixture.manifest,
          capabilities: [
            fixture.manifest.capabilities[0],
            fixture.manifest.capabilities[0],
          ],
        },
      }),
    { code: 'DUPLICATE_CAPABILITY' },
  );
  for (const schema of [
    { $async: true },
    { $ref: 'https://untrusted.test/schema' },
    { properties: { enabled: { type: 'string', format: 'unknown-format' } } },
  ]) {
    const manifest = structuredClone(fixture.manifest);
    Object.assign(manifest.capabilities[0].inputSchema, schema);
    assert.throws(() => new ConversationEngine({ ...options, manifest }), {
      code: 'INVALID_SCHEMA',
    });
  }
});
test('Node provider is server-only HTTPS, bounded, redirect-free, timed and has no automatic retries', async () => {
  const options = {
    endpoint: 'https://provider.test/chat/completions',
    apiKey: 'server-secret',
    model: 'fixture',
  };
  for (const endpoint of [
    'http://provider.test',
    'https://user:pass@provider.test',
    'https://provider.test/#fragment',
  ])
    assert.throws(() => new OpenAiCompatibleProvider({ ...options, endpoint }));
  let calls = 0;
  const provider = new OpenAiCompatibleProvider({
    ...options,
    fetch: async (url, init) => {
      calls++;
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bearer server-secret');
      assert.equal(JSON.parse(init.body).max_tokens, 100);
      return Response.json({
        choices: [
          { message: { content: JSON.stringify(fixture.drafts.action) } },
        ],
      });
    },
  });
  assert.deepEqual(await provider.complete([], [], 100), fixture.drafts.action);
  assert.equal(calls, 1);
  for (const response of [
    new Response('x', { status: 302 }),
    new Response('x', { headers: { 'content-encoding': 'gzip' } }),
    new Response('x'.repeat(262145)),
  ]) {
    await assert.rejects(
      new OpenAiCompatibleProvider({
        ...options,
        fetch: async () => response,
      }).complete([], [], 100),
    );
  }
  await assert.rejects(
    new OpenAiCompatibleProvider({
      ...options,
      timeoutMs: 15,
      fetch: () => new Promise(() => {}),
    }).complete([], [], 100),
  );
});
test('Node endpoint times out an uncooperative provider while retaining its charged attempt', async (t) => {
  const directory = await temporary(t);
  const store = new FileConversationStore(directory);
  const deadlines = [];
  // Expire after provider entry, not during unrelated durable disk setup under load.
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    assert.equal(milliseconds, 2000);
    const deadline = new AbortController();
    deadlines.push(deadline);
    return deadline.signal;
  });
  let providerCalls = 0;
  let resolveLate;
  let enteredProvider;
  const providerEntered = new Promise((resolve) => (enteredProvider = resolve));
  const handler = createChatHandler({
    origin,
    store,
    timeoutMs: 2000,
    authorize: async () => session,
    engine: new ConversationEngine({
      manifest: fixture.manifest,
      provider: {
        complete: () => {
          providerCalls++;
          enteredProvider();
          return providerCalls === 1
            ? new Promise((resolve) => (resolveLate = resolve))
            : Promise.resolve(fixture.drafts.final);
        },
      },
    }),
  });
  const responsePending = handler(request());
  await providerEntered;
  assert.equal(deadlines.length, 1);
  deadlines[0].abort(
    new DOMException('Fixture deadline expired.', 'TimeoutError'),
  );
  const response = await responsePending;
  assert.equal(providerCalls, 1);
  assert.equal(response.status, 502);
  let conversationId;
  await store.transaction(session.key, async (tx) => {
    const stored = await tx.load();
    assert.equal(stored.state.attempts, 1);
    conversationId = stored.state.id;
  });
  const recovered = await handler(
    request({
      ...fixture.request,
      requestId: 'explicit-follow-up',
      conversationId,
    }),
  );
  assert.equal(recovered.status, 200);
  resolveLate(fixture.drafts.action);
  await new Promise((resolve) => setImmediate(resolve));
  await store.transaction(session.key, async (tx) => {
    const stored = await tx.load();
    assert.equal(stored.state.attempts, 2);
    assert.equal(stored.state.pending, null);
    assert.equal(stored.state.steps, 0);
    assert.equal(stored.state.lastRequest, 'explicit-follow-up');
    assert.equal(stored.state.lastReply.response.finished, true);
  });
  assert.equal(providerCalls, 2);
  assert.equal(deadlines.length, 2);
});
