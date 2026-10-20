import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantClient, createHttpTransport } from '@pagesquire/client';
import { createInertiaNavigation } from '@pagesquire/react/inertia';
import { validateChatRequest } from '@pagesquire/protocol';

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
  const runtime = { observe: () => snapshot, registry: { list: () => [] } };
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
