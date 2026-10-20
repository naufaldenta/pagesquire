import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BrowserRuntime,
  CapabilityRegistry,
  NavigationStore,
  navigationCapability,
} from '@pagesquire/core';
import { validateActionResult } from '@pagesquire/protocol';

const url = 'https://example.test/next.html';
const call = {
  protocolVersion: '0.1',
  callId: 'request-1',
  capabilityId: 'browser.navigate',
  snapshotId: 'snapshot-1',
  parameters: { url },
};

function fixture(verify, options = {}) {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };
  const navigationStore = new NavigationStore(storage);
  const registry = new CapabilityRegistry(
    { schemaVersion: '0.1', capabilities: [navigationCapability] },
    {
      handlers: { 'browser.navigate': () => {} },
      verifiers: { 'browser.verifyNavigation': verify },
      parameters: {
        'browser.navigate': {
          schema: navigationCapability.inputSchema,
          validate: (input) => input?.url === url,
        },
      },
    },
  );
  const snapshot = {
    protocolVersion: '0.1',
    id: 'snapshot-1',
    url,
    title: 'Example',
    text: '',
    targets: [],
    truncated: { text: false, targets: false },
  };
  const observer = {
    document: { URL: url, defaultView: { sessionStorage: storage } },
    observe: () => structuredClone(snapshot),
    requireSnapshot: () => snapshot,
    allowedUrl: (value) => new URL(value),
  };
  const runtime = new BrowserRuntime({
    observer,
    registry,
    navigationStore,
    ...options,
  });
  return { runtime, navigationStore };
}

test('malformed verifier results never become successful actions', async () => {
  for (const verification of [
    null,
    {},
    { verified: 'yes' },
    { verified: true, evidence: [] },
    { verified: true, evidence: 'invalid' },
  ]) {
    const { runtime } = fixture(() => verification);
    const result = await runtime.execute(call);
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'INVALID_VERIFICATION');
    assert.equal(validateActionResult(result).valid, true);
  }
});

test('resumed navigation also validates evidence before returning a protocol result', async () => {
  const { runtime, navigationStore } = fixture(() => ({
    verified: true,
    evidence: 'invalid',
  }));
  navigationStore.save(call, new URL(url));
  const result = await runtime.resumeNavigation();
  assert.equal(result.status, 'failed');
  assert.equal(result.code, 'INVALID_VERIFICATION');
  assert.equal(validateActionResult(result).valid, true);
});

test('resumed verification preserves timeout and cancellation outcomes', async () => {
  const verify = async (_args, context) => {
    await context.waitFor(() => false);
    return { verified: true };
  };
  const timed = fixture(verify, { timeoutMs: 10 });
  timed.navigationStore.save(call, new URL(url));
  assert.equal((await timed.runtime.resumeNavigation()).code, 'TIMEOUT');

  const cancelled = fixture(verify);
  cancelled.navigationStore.save(call, new URL(url));
  const pending = cancelled.runtime.resumeNavigation();
  cancelled.runtime.cancel();
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.code, 'CANCELLED');
  assert.equal(cancelled.runtime.activity, 'idle');
});
