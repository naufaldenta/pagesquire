import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NavigationStore } from '@pagesquire/core';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const call = {
  protocolVersion: '0.1',
  callId: 'request-1',
  capabilityId: 'browser.navigate',
  snapshotId: 'snapshot-1',
  parameters: { url: '/next.html', ignoredSecret: 'never-persist-this' },
};

test('navigation checkpoints persist minimal metadata and are consumed only once', () => {
  const memory = storage();
  const store = new NavigationStore(memory);
  store.save(call, new URL('https://example.test/next.html'));
  assert.doesNotMatch(
    memory.getItem('pagesquire:navigation:0.1'),
    /never-persist-this|parameters|snapshotId/,
  );
  assert.equal(store.take('https://example.test').callId, call.callId);
  assert.equal(store.take('https://example.test'), undefined);
});

test('malformed, foreign-origin, expired, and future checkpoints are rejected and removed', () => {
  const base = {
    protocolVersion: '0.1',
    callId: 'request-1',
    expectedUrl: 'https://example.test/next.html',
    origin: 'https://example.test',
    issuedAt: Date.now(),
  };
  for (const input of [
    'not-json',
    JSON.stringify({ ...base, origin: 'https://other.test' }),
    JSON.stringify({ ...base, issuedAt: Date.now() - 120000 }),
    JSON.stringify({ ...base, issuedAt: Date.now() + 120000 }),
    JSON.stringify({ ...base, execute: 'arbitrary code' }),
    JSON.stringify({ ...base, callId: '__invalid call__' }),
  ]) {
    const memory = storage();
    memory.setItem('pagesquire:navigation:0.1', input);
    const store = new NavigationStore(memory);
    assert.equal(store.take('https://example.test'), undefined);
    assert.equal(memory.getItem('pagesquire:navigation:0.1'), null);
  }
});
