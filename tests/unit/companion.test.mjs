import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionDriver } from '../../packages/core/dist/index.js';

/** A page window whose "content script" answers through `extension`. */
function page(extension) {
  const listeners = [];
  const ports = [];
  const document = {};
  const view = {
    document,
    location: { origin: 'http://localhost:3000' },
    MessageChannel,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
    addEventListener: (type, listener) => listeners.push(listener),
    postMessage(data, origin, transfer = []) {
      assert.equal(origin, 'http://localhost:3000');
      if (data.type !== 'pagesquire:hello' || !extension) return;
      const port = transfer[0];
      ports.push(port);
      extension(port);
    },
    announce: () =>
      listeners.forEach((listener) =>
        listener({
          source: view,
          data: { type: 'pagesquire:companion-ready' },
        }),
      ),
    close: () => ports.forEach((port) => port.close()),
  };
  return view;
}

/** Acks the handshake, then answers each call with `reply(call)`. */
const companion =
  (reply, calls = []) =>
  (port) => {
    port.onmessage = ({ data }) => {
      calls.push(data);
      port.postMessage({ id: data.id, ...reply(data) });
    };
    port.postMessage({
      type: 'pagesquire:hello-ack',
      version: 1,
      features: [],
    });
  };

function element(view, extra = {}) {
  const attributes = new Map();
  return {
    ownerDocument: view.document,
    getRootNode: () => view.document,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    attributes,
    value: 'old',
    selectionStart: 0,
    focused: false,
    selected: undefined,
    focus() {
      this.focused = true;
    },
    select() {
      this.selected = 'all';
    },
    setSelectionRange(start, end) {
      this.selected = [start, end];
    },
    ...extra,
  };
}

const signature = { claims: '{}', value: `${'A'.repeat(86)}==` };
const context = (signal = new AbortController().signal, signed = true) => ({
  signal,
  call: signed ? { signature } : {},
});

test('without the extension every input keeps the synthetic path', async () => {
  const view = page();
  const driver = createCompanionDriver({ view, helloTimeoutMs: 20 });
  assert.equal(await driver.connected(), false);
  assert.equal(await driver.click(element(view), context()), false);
});

test('a refused handshake also keeps the synthetic path', async () => {
  const view = page((port) =>
    port.postMessage({ type: 'pagesquire:hello-nack' }),
  );
  const driver = createCompanionDriver({ view, helloTimeoutMs: 1000 });
  const started = Date.now();
  assert.equal(await driver.connected(), false);
  assert.ok(Date.now() - started < 500);
  view.close();
});

test('a slow extension that confirms its relay is waited for', async () => {
  const view = page((port) => {
    port.postMessage({ type: 'pagesquire:hello-wait' });
    setTimeout(
      () =>
        port.postMessage({
          type: 'pagesquire:hello-ack',
          version: 1,
          features: [],
        }),
      150,
    );
  });
  const driver = createCompanionDriver({ view, helloTimeoutMs: 20 });
  assert.equal(await driver.connected(), true);
  view.close();
});

test('clicks, text and keys go to the extension with a one-call nonce', async () => {
  const calls = [];
  let tagged;
  let target;
  const view = page(
    companion(() => {
      tagged = target.attributes.get('data-pagesquire-target');
      return { ok: true };
    }, calls),
  );
  target = element(view);
  const driver = createCompanionDriver({ view });
  assert.equal(await driver.click(target, context()), true);
  assert.match(calls[0].args.nonce, /^[a-f0-9]{32}$/);
  assert.equal(tagged, calls[0].args.nonce);
  assert.equal(target.attributes.size, 0);
  // The server's signature travels with the input; the extension checks it.
  assert.deepEqual(
    { ...calls[0], args: { ...calls[0].args, nonce: 'n' } },
    { id: 1, op: 'act', args: { kind: 'click', nonce: 'n', signature } },
  );

  assert.equal(await driver.type(target, 'Ada', true, context()), true);
  assert.equal(target.focused, true);
  assert.equal(target.selected, 'all');
  assert.deepEqual(calls[1].args.text, 'Ada');
  assert.equal(await driver.type(target, 'Ada', false, context()), true);
  assert.deepEqual(target.selected, [3, 3]);

  assert.equal(await driver.pressKey(target, 'Enter', context()), true);
  assert.equal(calls[3].args.key, 'Enter');
  // Escape stays synthetic: a trusted Escape is the visitor's stop key.
  assert.equal(await driver.pressKey(target, 'Escape', context()), false);
  assert.equal(calls.length, 4);
  view.close();
});

test('inputs the extension cannot place keep the synthetic path', async () => {
  const calls = [];
  const view = page(companion(() => ({ ok: true }), calls));
  const driver = createCompanionDriver({ view });
  assert.equal(
    await driver.type(
      element(view, { selectionStart: null }),
      'a',
      true,
      context(),
    ),
    false,
  );
  assert.equal(await driver.type(element(view), '', true, context()), false);
  const shadow = element(view, { getRootNode: () => ({}) });
  assert.equal(await driver.click(shadow, context()), false);
  const framed = element(view, { ownerDocument: {} });
  assert.equal(await driver.click(framed, context()), false);
  // Unsigned calls: the extension would refuse them, so they stay synthetic.
  const unsigned = context(undefined, false);
  assert.equal(await driver.click(element(view), unsigned), false);
  assert.equal(await driver.type(element(view), 'a', true, unsigned), false);
  assert.equal(await driver.pressKey(element(view), 'Enter', unsigned), false);
  assert.equal(calls.length, 0);
  view.close();
});

test('extension refusals become runtime error codes', async () => {
  let code;
  const view = page(companion(() => ({ ok: false, code })));
  const driver = createCompanionDriver({ view });
  for (const [reply, expected] of [
    ['OBSCURED', 'TARGET_COVERED'],
    ['TARGET_NOT_ALLOWED', 'TARGET_NOT_ALLOWED'],
    ['TARGET_MISSING', 'TARGET_MISSING'],
    ['NOT_VISIBLE', 'TARGET_HIDDEN'],
    ['STOPPED', 'VISITOR_DECLINED'],
    ['RATE_LIMITED', 'ACTION_FAILED'],
    ['BAD_SIGNATURE', 'ACTION_FAILED'],
    ['REPLAYED', 'ACTION_FAILED'],
  ]) {
    code = reply;
    await assert.rejects(driver.click(element(view), context()), {
      name: 'PageSquireError',
      code: expected,
    });
  }
  // Stopped earlier, revoked or out of scope: the page continues alone.
  code = 'UNAVAILABLE';
  assert.equal(await driver.click(element(view), context()), false);
  view.close();
});

test('a silent extension times out and an aborted call stops waiting', async () => {
  const view = page((port) =>
    port.postMessage({ type: 'pagesquire:hello-ack', version: 1 }),
  );
  const driver = createCompanionDriver({ view, callTimeoutMs: 100 });
  const target = element(view);
  await assert.rejects(driver.click(target, context()), {
    code: 'ACTION_FAILED',
  });
  assert.equal(target.attributes.size, 0);
  const controller = new AbortController();
  const pending = driver.click(target, context(controller.signal));
  setTimeout(() => controller.abort(new Error('cancelled')), 10);
  await assert.rejects(pending, /cancelled/);
  view.close();
});

test('an extension enabled mid-visit announces itself', async () => {
  let enabled = false;
  const view = page((port) => {
    if (enabled) companion(() => ({ ok: true }))(port);
  });
  const driver = createCompanionDriver({ view, helloTimeoutMs: 20 });
  assert.equal(await driver.connected(), false);
  enabled = true;
  assert.equal(await driver.connected(), false);
  view.announce();
  assert.equal(await driver.connected(), true);
  view.close();
});

test('companion timeouts are bounded', () => {
  for (const options of [
    { helloTimeoutMs: 0 },
    { helloTimeoutMs: 6000 },
    { callTimeoutMs: 50 },
    { callTimeoutMs: 1.5 },
  ])
    assert.throws(() => createCompanionDriver({ view: page(), ...options }), {
      code: 'INVALID_OPTIONS',
    });
});

test('frames pushed on the port feed snapshots; frame calls need no page nonce', async () => {
  const calls = [];
  let push;
  const frame = {
    id: 'frame1',
    origin: 'http://maps.test',
    title: 'Maps',
    text: 'Map',
    targets: [],
    truncated: { text: false, targets: false },
  };
  const view = page((port) => {
    push = (frames) => port.postMessage({ type: 'pagesquire:frames', frames });
    companion(
      (call) =>
        call.op === 'frame-inspect'
          ? { ok: true, info: { risk: 'allow', label: 'Pin', link: false } }
          : {
              ok: true,
              effect: {
                mutations: 1,
                urlChanged: false,
                focusChanged: false,
                stateChanged: true,
              },
            },
      calls,
    )(port);
  });
  const driver = createCompanionDriver({ view });
  assert.deepEqual(driver.frames(), []);
  assert.equal(await driver.connected(), true);
  push([frame]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(driver.frames(), [frame]);

  assert.deepEqual(
    await driver.frameTarget('frame1', 'target-2', 'click', context()),
    { risk: 'allow', label: 'Pin', link: false },
  );
  assert.deepEqual(
    await driver.frameAct(
      {
        frame: 'frame1',
        target: 'target-2',
        action: 'type',
        text: 'a',
        clear: true,
      },
      context(),
    ),
    {
      mutations: 1,
      urlChanged: false,
      focusChanged: false,
      stateChanged: true,
    },
  );
  assert.deepEqual(
    calls.map((call) => [call.op, call.args]),
    [
      [
        'frame-inspect',
        { frame: 'frame1', target: 'target-2', action: 'click' },
      ],
      [
        'act',
        {
          frame: 'frame1',
          target: 'target-2',
          text: 'a',
          clear: true,
          kind: 'type',
          signature,
        },
      ],
    ],
  );
  // Frames have no synthetic fallback, so unsigned calls fail instead.
  await assert.rejects(
    driver.frameAct(
      { frame: 'frame1', target: 'target-2', action: 'click' },
      context(undefined, false),
    ),
    { code: 'ACTION_FAILED' },
  );
  view.close();
});

test('without the extension, frame targets fail instead of falling back', async () => {
  const driver = createCompanionDriver({ view: page(), helloTimeoutMs: 20 });
  await assert.rejects(
    driver.frameTarget('frame1', 'target-1', 'click', context()),
    { code: 'TARGET_MISSING' },
  );
});

test('session tabs pushed on the port feed snapshots, and switching is signed', async () => {
  const calls = [];
  let push;
  const view = page((port) => {
    push = (tabs) => port.postMessage({ type: 'pagesquire:tabs', tabs });
    companion(() => ({ ok: true }), calls)(port);
  });
  const driver = createCompanionDriver({ view });
  assert.deepEqual(driver.tabs(), []);
  assert.equal(await driver.connected(), true);
  const tab = {
    id: 'tab2',
    url: 'http://shop.test/cart',
    title: 'Cart',
    text: '',
    targets: [],
    truncated: { text: false, targets: false },
    active: false,
  };
  push([tab]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(driver.tabs(), [tab]);
  assert.equal(await driver.switchTab('tab2', context()), true);
  assert.deepEqual(calls[0].args, { kind: 'switch', tab: 'tab2', signature });
  await assert.rejects(driver.switchTab('tab2', context(undefined, false)), {
    code: 'ACTION_FAILED',
  });
  view.close();
});
