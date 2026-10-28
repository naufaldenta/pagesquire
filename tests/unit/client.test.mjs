import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantClient, createHttpTransport } from '@pagesquire/client';
import { createInertiaNavigation } from '@pagesquire/react/inertia';
import { validateChatRequest } from '@pagesquire/protocol';
import { PageSquireError } from '@pagesquire/core';

const snapshot = {
  protocolVersion: '0.1',
  id: 'snapshot-1',
  url: 'https://example.test/',
  title: 'Demo',
  text: '',
  targets: [],
  truncated: { text: false, targets: false },
};
const final = {
  protocolVersion: '0.1',
  conversationId: 'conversation-1',
  response: {
    protocolVersion: '0.1',
    text: 'Hello',
    emotion: 'hover',
    finished: true,
    toolCalls: [],
  },
};
function client(transport, options = {}) {
  const runtime = {
    observe: () => snapshot,
    registry: { list: () => [] },
    resetSession() {},
  };
  return new AssistantClient({ runtime, transport, ...options });
}

test('chat request contract rejects injected history, ambiguous turn input, and result without conversation', () => {
  const request = {
    protocolVersion: '0.1',
    requestId: 'request-1',
    snapshot,
    capabilityIds: [],
    message: 'Hello',
  };
  assert.equal(validateChatRequest(request).valid, true);
  for (const value of [
    { ...request, history: [] },
    { ...request, message: ' ' },
    { ...request, result: {} },
    { ...request, message: undefined, result: {} },
  ])
    assert.equal(validateChatRequest(value).valid, false);
});

test('client carries final emotion and bounded conversation ID into the next message', async () => {
  const requests = [];
  const emotions = [];
  const instance = client(
    async (request) => {
      requests.push(request);
      return final;
    },
    { onEmotionChange: (emotion) => emotions.push(emotion) },
  );
  await instance.send('Hello');
  await instance.send('Again');
  assert.deepEqual(emotions, ['thinking', 'hover', 'thinking', 'hover']);
  assert.equal(requests[1].conversationId, 'conversation-1');
  assert.equal(instance.state.busy, false);
  assert.equal(instance.state.messages.length, 4);
  instance.reset();
  assert.equal(instance.state.messages.length, 0);
});

test('a known provider failure preserves completed conversation context for the next user message without automatic retry', async () => {
  const requests = [];
  const instance = client(async (request) => {
    requests.push(request);
    if (requests.length === 2)
      throw new PageSquireError(
        'INVALID_PROVIDER_RESPONSE',
        'The AI provider could not return a valid response.',
      );
    return final;
  });
  await instance.send('First question');
  await instance.send('Offer another action');
  assert.equal(requests.length, 2);
  assert.equal(instance.state.busy, false);
  await instance.send('Yes, do that');
  assert.equal(requests.length, 3);
  assert.equal(requests[2].conversationId, 'conversation-1');
  assert.equal(instance.state.messages.at(-1).text, 'Hello');
});

test('HTTP errors distinguish limits, session expiry and provider failures without exposing response bodies', async () => {
  for (const [status, message] of [
    [403, /access is unavailable/],
    [409, /expired/],
    [419, /session expired/],
    [429, /usage limit/],
    [502, /provider/],
    [503, /temporarily unavailable/],
  ]) {
    const transport = createHttpTransport({
      endpoint: '/chat',
      baseUrl: snapshot.url,
      csrfToken: () => 'token',
      fetch: async () =>
        new Response('private-secret <script>alert(1)</script>', {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
    await assert.rejects(
      transport({}, new AbortController().signal),
      (error) => {
        assert.match(error.message, message);
        assert.doesNotMatch(error.message, /private-secret|script/);
        return error.code === `HTTP_${status}`;
      },
    );
  }
});

test('only allowlisted bounded error codes distinguish denied capabilities from expired authentication', async () => {
  for (const [code, expected] of [
    ['ACCESS_DENIED', 'ACCESS_DENIED'],
    ['CAPABILITY_DENIED', 'CAPABILITY_DENIED'],
    ['secret-code<script>', 'HTTP_403'],
  ]) {
    const transport = createHttpTransport({
      endpoint: '/chat',
      baseUrl: snapshot.url,
      csrfToken: () => 'token',
      fetch: async () =>
        Response.json(
          { error: { code, message: 'private-secret' } },
          { status: 403 },
        ),
    });
    await assert.rejects(
      transport({}, new AbortController().signal),
      (error) =>
        error.code === expected &&
        !error.message.includes('private-secret') &&
        !error.message.includes('script'),
    );
  }
  const oversized = createHttpTransport({
    endpoint: '/chat',
    baseUrl: snapshot.url,
    csrfToken: () => 'token',
    fetch: async () =>
      new Response('x'.repeat(5000), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  await assert.rejects(oversized({}, new AbortController().signal), {
    code: 'HTTP_403',
  });
});

test('cancel and timeout settle even a transport that ignores its AbortSignal', async () => {
  const instance = client(() => new Promise(() => {}));
  const pending = instance.send('Hello');
  await assert.rejects(instance.send('Again'), { code: 'BUSY' });
  instance.cancel();
  await pending;
  assert.equal(instance.state.busy, false);
  assert.match(instance.state.messages.at(-1).text, /cancelled/);
  const timeout = client(() => new Promise(() => {}), { timeoutMs: 5 });
  await timeout.send('Hello');
  assert.match(timeout.state.messages.at(-1).text, /timed out/);
});

for (const interruption of ['cancel', 'timeout'])
  test(`${interruption} ignores a late transport reply and permits another message without replay`, async () => {
    let resolveLate;
    const requests = [];
    const instance = client(
      (request) => {
        requests.push(request);
        return requests.length === 1
          ? new Promise((resolve) => (resolveLate = resolve))
          : Promise.resolve({ ...final, conversationId: 'fresh-conversation' });
      },
      { timeoutMs: interruption === 'timeout' ? 20 : 60000 },
    );
    const interrupted = instance.send('First question');
    if (interruption === 'cancel') instance.cancel();
    await interrupted;
    assert.equal(instance.state.busy, false);
    await instance.send('A fresh question');
    const completed = instance.state;
    assert.equal(requests.length, 2);
    assert.equal(requests[1].conversationId, undefined);
    assert.equal(completed.messages.at(-1).text, 'Hello');
    resolveLate({
      ...final,
      response: { ...final.response, text: 'Stale response must be ignored' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(instance.state, completed);
    await instance.send('Continue the fresh conversation');
    assert.equal(requests[2].conversationId, 'fresh-conversation');
  });

test('HTTP transport enforces same-origin, CSRF, bounded responses and sanitized errors', async () => {
  assert.throws(
    () =>
      createHttpTransport({
        endpoint: 'https://other.test',
        baseUrl: snapshot.url,
        csrfToken: () => 'token',
      }),
    { code: 'INVALID_ENDPOINT' },
  );
  const make = (fetch, csrfToken = () => 'csrf') =>
    createHttpTransport({
      endpoint: '/chat',
      baseUrl: snapshot.url,
      csrfToken,
      fetch,
    });
  const signal = new AbortController().signal;
  await assert.rejects(
    make(
      () => assert.fail('No request allowed'),
      () => '',
    )({}, signal),
    { code: 'CSRF_REQUIRED' },
  );
  const safe = make(async (url, options) => {
    assert.equal(options.headers['X-CSRF-TOKEN'], 'csrf');
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(final), {
      headers: { 'content-type': 'application/json' },
    });
  });
  assert.deepEqual(await safe({}, signal), final);
  await assert.rejects(
    make(async () => new Response('synthetic-secret', { status: 500 }))(
      {},
      signal,
    ),
    (error) => !error.message.includes('synthetic-secret'),
  );
  await assert.rejects(
    make(
      async () =>
        new Response('x'.repeat(196609), {
          headers: { 'content-type': 'application/json' },
        }),
    )({}, signal),
    { code: 'INVALID_RESPONSE' },
  );
});

test('Inertia adapter resolves only success and cancels its own visit token', async () => {
  let options;
  let cancels = 0;
  const adapter = createInertiaNavigation({
    visit: (url, value) => {
      assert.equal(url, 'https://example.test/next');
      options = value;
      value.onCancelToken({ cancel: () => cancels++ });
    },
  });
  const controller = new AbortController();
  const pending = adapter.navigate(
    new URL('https://example.test/next'),
    controller.signal,
  );
  options.onSuccess();
  options.onFinish();
  await pending;
  const other = adapter.navigate(
    new URL('https://example.test/next'),
    controller.signal,
  );
  controller.abort(new Error('cancel this visit'));
  await assert.rejects(other, /cancel this visit/);
  assert.equal(cancels, 1);
  const failure = adapter.navigate(
    new URL('https://example.test/next'),
    new AbortController().signal,
  );
  options.onFinish();
  await assert.rejects(failure, { code: 'NAVIGATION_FAILED' });
});
