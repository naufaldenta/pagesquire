import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '../../packages/core/dist/index.js';
import { createVisitorPrompt, id } from '../../packages/client/dist/index.js';

const snapshot = {
  protocolVersion: '0.1',
  id: 'snapshot',
  url: 'https://example.test/',
  title: '',
  text: '',
  targets: [],
  truncated: { text: false, targets: false },
};
let counter = 0;
const call = (capabilityId, parameters) => ({
  protocolVersion: '0.1',
  callId: `visitor-call-${++counter}`,
  capabilityId,
  snapshotId: snapshot.id,
  parameters,
});
const ask = (options = ['Blue', 'Red']) =>
  call('ui.ask', { question: 'Which colour?', options });
const handOff = () =>
  call('ui.hand_off', { instruction: 'Sign in with your account.' });

function fixture(runtimeOptions = {}) {
  const generic = core.createGenericBindings();
  const capabilities = generic.capabilities.filter((entry) =>
    ['ui.ask', 'ui.hand_off'].includes(entry.id),
  );
  const registry = new core.CapabilityRegistry(
    { schemaVersion: '0.1', capabilities },
    {
      handlers: generic.handlers,
      verifiers: generic.verifiers,
      parameters: Object.fromEntries(
        capabilities.map((entry) => [
          entry.id,
          { schema: entry.inputSchema, validate: () => true },
        ]),
      ),
    },
  );
  return new core.BrowserRuntime({
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
}

test('ui.ask returns only an offered option and the visitor time does not count against the action limit', async () => {
  const seen = [];
  const runtime = fixture({
    timeoutMs: 40,
    visitor: async (request) => {
      seen.push(request);
      await new Promise((resolve) => setTimeout(resolve, 120));
      return 'Red';
    },
  });
  const result = await runtime.execute(ask());
  assert.equal(result.status, 'success');
  assert.deepEqual(result.evidence, { answer: 'Red' });
  assert.equal(seen[0].kind, 'choice');
  assert.equal(seen[0].question, 'Which colour?');
  assert.ok(Object.isFrozen(seen[0]) && Object.isFrozen(seen[0].options));
  for (const answer of ['Purple', null, 42, 'done']) {
    const declined = await fixture({ visitor: () => answer }).execute(ask());
    assert.equal(declined.code, 'VISITOR_DECLINED', String(answer));
  }
});

test('ui.hand_off waits for the visitor to finish and fails closed otherwise', async () => {
  const done = await fixture({
    visitor: (request) => (request.kind === 'handoff' ? 'done' : null),
  }).execute(handOff());
  assert.equal(done.status, 'success');
  assert.deepEqual(done.evidence, { visitorFinished: true });
  assert.equal(
    (await fixture({ visitor: () => 'Blue' }).execute(handOff())).code,
    'VISITOR_DECLINED',
  );
  assert.equal(
    (
      await fixture({ visitor: () => Promise.reject(new Error('x')) }).execute(
        handOff(),
      )
    ).code,
    'VISITOR_DECLINED',
  );
  assert.equal(
    (await fixture().execute(handOff())).code,
    'VISITOR_UNAVAILABLE',
  );
  assert.equal(
    (
      await fixture({
        visitorTimeoutMs: 20,
        visitor: () => new Promise(() => {}),
      }).execute(handOff())
    ).code,
    'VISITOR_TIMEOUT',
  );
});

test('cancelling withdraws the visitor prompt and bounds its options', async () => {
  let withdrawn;
  const runtime = fixture({
    visitor: (request) =>
      new Promise((resolve) => {
        request.signal.addEventListener('abort', () => {
          withdrawn = true;
          resolve('Blue');
        });
      }),
  });
  const pending = runtime.execute(ask());
  await new Promise((resolve) => setTimeout(resolve, 10));
  runtime.cancel();
  assert.equal((await pending).code, 'CANCELLED');
  assert.equal(withdrawn, true);
  for (const options of [
    { visitorTimeoutMs: 0 },
    { visitorTimeoutMs: 900001 },
    { visitor: 'yes' },
  ])
    assert.throws(() => fixture(options), { code: 'INVALID_OPTIONS' });
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
function fakeHost(lang) {
  const document = {
    createElement: (tag) => new FakeElement(tag, document),
    activeElement: null,
    documentElement: { lang },
  };
  return new FakeElement('div', document);
}
const actions = (host) => host.children[0].children.at(-1).children;

test('the visitor prompt shows options as text-only buttons and answers only from a click', async () => {
  const host = fakeHost('en');
  const prompt = createVisitorPrompt(host);
  const controller = new AbortController();
  const request = {
    kind: 'choice',
    question: '<img src=x onerror=alert(1)> Which size?',
    options: ['Small', 'Large'],
    signal: controller.signal,
  };
  const first = prompt(request);
  const panel = host.children[0];
  assert.equal(panel.attributes.role, 'alertdialog');
  assert.equal(panel.attributes['data-pagesquire-root'], '');
  assert.match(panel.children[1].textContent, /^<img src=x/);
  const [small, large, cancel] = actions(host);
  assert.deepEqual(
    [small.textContent, large.textContent, cancel.textContent],
    ['Small', 'Large', 'Cancel'],
  );
  assert.equal(host.ownerDocument.activeElement, small);
  assert.equal(await prompt(request), null, 'A second prompt is refused');
  large.dispatch('click');
  assert.equal(await first, 'Large');
  assert.equal(host.children.length, 0);
  const second = prompt(request);
  actions(host)[2].dispatch('click');
  assert.equal(await second, null);
  const third = prompt(request);
  host.children[0].dispatch('keydown', { key: 'Escape' });
  assert.equal(await third, null);
  const fourth = prompt(request);
  controller.abort();
  assert.equal(await fourth, null);
});

test('a hand-off leaves focus on the page and is localized', async () => {
  const host = fakeHost('id');
  const prompt = createVisitorPrompt(host);
  const pending = prompt({
    kind: 'handoff',
    instruction: 'Masuk dengan akunmu.',
    signal: new AbortController().signal,
  });
  const panel = host.children[0];
  assert.equal(panel.attributes.role, 'region');
  assert.equal(panel.attributes['aria-live'], 'polite');
  assert.equal(panel.attributes['data-kind'], 'handoff');
  assert.equal(panel.children[0].textContent, id['visitor.handoffTitle']);
  assert.equal(panel.children[2].textContent, id['visitor.handoffHelp']);
  assert.equal(host.ownerDocument.activeElement, null);
  const [finished] = actions(host);
  assert.equal(finished.textContent, 'Sudah selesai');
  finished.dispatch('click');
  assert.equal(await pending, 'done');
});
