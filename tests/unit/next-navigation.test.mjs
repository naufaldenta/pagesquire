import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNextNavigation } from '@pagesquire/react/next';
import { ChatNavigationStore } from '@pagesquire/client';
test('Next push waits for the matching committed destination, never just the URL invocation', async () => {
  const document = { URL: 'https://example.test/' };
  let pushed;
  let completed = false;
  const navigation = createNextNavigation(
    {
      push: (url) => {
        pushed = url;
      },
    },
    { document },
  );
  const result = navigation
    .navigate(
      new URL('https://example.test/next'),
      new AbortController().signal,
    )
    .then(() => {
      completed = true;
    });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(pushed, '/next');
  navigation.committed('https://example.test/next');
  await Promise.resolve();
  assert.equal(completed, false);
  document.URL = 'https://example.test/next';
  navigation.committed(document.URL);
  await result;
  assert.equal(completed, true);
});
test('Next adapter bounds waiting, denies foreign URLs, detects redirects and handles abort', async () => {
  const document = { URL: 'https://example.test/' };
  const create = () =>
    createNextNavigation({ push() {} }, { document, timeoutMs: 15 });
  await assert.rejects(
    create().navigate(
      new URL('https://other.test/'),
      new AbortController().signal,
    ),
    { code: 'URL_DENIED' },
  );
  await assert.rejects(
    create().navigate(
      new URL('https://example.test/next'),
      new AbortController().signal,
    ),
    { code: 'TIMEOUT' },
  );
  const navigation = create();
  const signal = new AbortController();
  const first = navigation.navigate(
    new URL('https://example.test/next'),
    signal.signal,
  );
  await assert.rejects(
    navigation.navigate(new URL('https://example.test/other'), signal.signal),
    { code: 'BUSY' },
  );
  signal.abort();
  await assert.rejects(first, { code: 'CANCELLED' });
  const redirected = navigation.navigate(
    new URL('https://example.test/next'),
    new AbortController().signal,
  );
  document.URL = 'https://example.test/unexpected';
  navigation.committed(document.URL);
  await assert.rejects(redirected, { code: 'NAVIGATION_MISMATCH' });
});
test('chat navigation checkpoints are short-lived, same-origin, single-use and contain no transcript', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const store = new ChatNavigationStore(storage);
  const checkpoint = {
    conversationId: 'conversation',
    callId: 'call',
    origin: 'https://example.test',
    expectedUrl: 'https://example.test/next',
    issuedAt: Date.now(),
    remainingRounds: 2,
  };
  store.save(checkpoint);
  assert.deepEqual(store.take(checkpoint.origin), checkpoint);
  assert.equal(store.take(checkpoint.origin), undefined);
  for (const change of [
    { issuedAt: Date.now() - 61000 },
    { issuedAt: Date.now() + 10000 },
    { origin: 'https://other.test' },
    { expectedUrl: 'https://other.test/' },
    { remainingRounds: 0 },
    { transcript: 'private' },
    { callId: {} },
  ]) {
    store.save({ ...checkpoint, ...change });
    assert.equal(store.take(checkpoint.origin), undefined);
  }
  assert.throws(
    () =>
      new ChatNavigationStore({
        setItem() {
          throw new Error();
        },
      }).save(checkpoint),
    { code: 'NAVIGATION_UNAVAILABLE' },
  );
});
