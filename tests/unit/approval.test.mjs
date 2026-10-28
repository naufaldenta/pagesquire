import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import * as core from '../../packages/core/dist/index.js';
import { createApprovalPrompt } from '../../packages/client/dist/index.js';
import { ConversationEngine } from '@pagesquire/server';

const definition = {
  id: 'order.cancel',
  description: 'Cancel the open order.',
  execution: 'browser',
  handler: 'cancel',
  verification: { handler: 'verifyCancel' },
  risk: 'consequential',
  inputSchema: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
    additionalProperties: false,
  },
};
const snapshot = {
  protocolVersion: '0.1',
  id: 'snapshot',
  url: 'https://example.test/',
  title: '',
  text: '',
  targets: [],
  truncated: { text: false, targets: false },
};
const call = {
  protocolVersion: '0.1',
  callId: 'approval-call',
  capabilityId: definition.id,
  snapshotId: snapshot.id,
  parameters: { orderId: 'A-1' },
};
function fixture(runtimeOptions = {}) {
  const state = { cancelled: 0 };
  const registry = new core.CapabilityRegistry(
    { schemaVersion: '0.1', capabilities: [definition] },
    {
      handlers: { cancel: () => void state.cancelled++ },
      verifiers: { verifyCancel: () => ({ verified: state.cancelled === 1 }) },
      parameters: {
        [definition.id]: {
          schema: definition.inputSchema,
          validate: (input) => typeof input.orderId === 'string',
        },
      },
    },
  );
  const runtime = new core.BrowserRuntime({
    observer: {
      document: {
        URL: snapshot.url,
        defaultView: { crypto: globalThis.crypto },
      },
      observe: () => structuredClone(snapshot),
      requireSnapshot: () => snapshot,
    },
    registry,
    ...runtimeOptions,
  });
  return { runtime, state };
}

test('consequential actions stay blocked without an approval prompt', async () => {
  const f = fixture();
  assert.equal(f.runtime.approvalEnabled, false);
  const result = await f.runtime.execute(call);
  assert.equal(result.code, 'CONFIRMATION_REQUIRED');
  assert.equal(f.state.cancelled, 0);
});

test('only an explicit true approval runs the handler and verifier', async () => {
  const requests = [];
  const approved = fixture({
    approve: (request) => {
      requests.push(request);
      return true;
    },
  });
  assert.equal(approved.runtime.approvalEnabled, true);
  assert.equal((await approved.runtime.execute(call)).code, 'VERIFIED');
  assert.equal(approved.state.cancelled, 1);
  assert.equal(requests[0].capabilityId, 'order.cancel');
  assert.equal(requests[0].description, 'Cancel the open order.');
  assert.deepEqual(requests[0].parameters, { orderId: 'A-1' });
  assert.ok(Object.isFrozen(requests[0].parameters));
  for (const answer of [false, 'yes', 1, undefined]) {
    const denied = fixture({ approve: () => answer });
    const result = await denied.runtime.execute(call);
    assert.equal(result.status, 'cancelled');
    assert.equal(result.code, 'APPROVAL_DENIED');
    assert.equal(denied.state.cancelled, 0);
  }
  const throwing = fixture({
    approve: () => {
      throw new Error('host-prompt-marker');
    },
  });
  const failed = await throwing.runtime.execute(call);
  assert.equal(failed.code, 'APPROVAL_DENIED');
  assert.doesNotMatch(JSON.stringify(failed), /host-prompt-marker/);
});

test('approval waiting is outside the action timer but bounded and cancellable', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release;
  const slow = fixture({
    timeoutMs: 10,
    approve: () => new Promise((resolve) => (release = resolve)),
  });
  const pending = slow.runtime.execute(call);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(50);
  release(true);
  assert.equal((await pending).code, 'VERIFIED');
  const expiring = fixture({
    approvalTimeoutMs: 100,
    approve: () => new Promise(() => {}),
  });
  const expired = expiring.runtime.execute({ ...call, callId: 'expires' });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(100);
  assert.equal((await expired).code, 'APPROVAL_TIMEOUT');
  let seen;
  const cancelling = fixture({
    approve: (request) => {
      seen = request.signal;
      return new Promise(() => {});
    },
  });
  const cancelled = cancelling.runtime.execute({ ...call, callId: 'cancel' });
  await new Promise((resolve) => setImmediate(resolve));
  cancelling.runtime.cancel();
  assert.equal((await cancelled).status, 'cancelled');
  assert.equal(seen.aborted, true);
  assert.equal(cancelling.state.cancelled, 0);
  assert.throws(() => fixture({ approve: 'yes' }), { code: 'INVALID_OPTIONS' });
});

test('WebMCP exposes consequential tools only when the runtime can ask for approval', async () => {
  const tools = new Map();
  const modelContext = { registerTool: (tool) => tools.set(tool.name, tool) };
  await core.exposeToWebMcp(fixture().runtime, { modelContext });
  assert.equal(tools.size, 0);
  const f = fixture({ approve: () => true });
  await core.exposeToWebMcp(f.runtime, { modelContext });
  assert.equal(tools.get('order.cancel').annotations.consequentialHint, true);
  assert.equal(
    (await tools.get('order.cancel').execute({ orderId: 'A-1' })).code,
    'VERIFIED',
  );
});

class FakeElement {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.textContent = '';
    this.parent = null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (node) => node !== this,
      );
    this.parent = null;
  }
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  removeEventListener() {}
  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
}
function fakeHost() {
  const document = {
    createElement: (tag) => new FakeElement(tag, document),
    activeElement: null,
  };
  return new FakeElement('div', document);
}
const buttons = (host) => host.children[0].children[2].children;

test('the approval prompt resolves true only from its approve button and renders text safely', async () => {
  const host = fakeHost();
  const approve = createApprovalPrompt(host);
  const controller = new AbortController();
  const request = {
    capabilityId: 'order.cancel',
    description: '<img src=x onerror=alert(1)> Cancel the open order.',
    parameters: { orderId: 'A-1' },
    signal: controller.signal,
  };
  const first = approve(request);
  const panel = host.children[0];
  assert.equal(panel.attributes.role, 'alertdialog');
  assert.equal(panel.attributes['data-pagesquire-root'], '');
  assert.match(panel.children[1].textContent, /^<img src=x/);
  const [deny, accept] = buttons(host);
  assert.equal(host.ownerDocument.activeElement, deny);
  assert.equal(await approve(request), false, 'A second prompt is refused');
  accept.dispatch('click');
  assert.equal(await first, true);
  assert.equal(host.children.length, 0);
  const second = approve(request);
  buttons(host)[0].dispatch('click');
  assert.equal(await second, false);
  const third = approve(request);
  host.children[0].dispatch('keydown', { key: 'Escape' });
  assert.equal(await third, false);
  const fourth = approve(request);
  controller.abort();
  assert.equal(await fourth, false);
  assert.equal(host.children.length, 0);
});

test('engines offer consequential capabilities only when the host opts in', async () => {
  const fixtureData = JSON.parse(
    await readFile(
      new URL('../fixtures/conformance.json', import.meta.url),
      'utf8',
    ),
  );
  const seen = [];
  const make = (allowConsequential) =>
    new ConversationEngine({
      manifest: fixtureData.manifest,
      ...(allowConsequential ? { allowConsequential } : {}),
      provider: {
        async complete(messages, capabilities) {
          seen.push({
            ids: capabilities.map((entry) => entry.id),
            system: messages[0].content,
          });
          return structuredClone(fixtureData.drafts.consequential);
        },
      },
    });
  const ids = ['testing.set', 'account.delete'];
  await assert.rejects(make(false).handle(fixtureData.request, null, ids), {
    code: 'CAPABILITY_DENIED',
  });
  assert.deepEqual(seen[0].ids, ['testing.set']);
  assert.doesNotMatch(seen[0].system, /explicit approval by the visitor/);
  const reply = await make(true).handle(fixtureData.request, null, ids);
  assert.equal(
    reply.reply.response.toolCalls[0].capabilityId,
    'account.delete',
  );
  assert.deepEqual(seen[1].ids, ids);
  assert.match(seen[1].system, /explicit approval by the visitor/);
  await assert.rejects(
    make(true).handle(fixtureData.request, null, ['testing.set']),
    { code: 'CAPABILITY_DENIED' },
  );
});
