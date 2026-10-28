import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateActionResult } from '@pagesquire/protocol';
import {
  createCompanionDriver,
  createGenericBindings,
  createGenericCapabilities,
  createScreenshotCapabilities,
} from '../../packages/core/dist/index.js';
import { ConversationEngine, siteDeclaration } from '@pagesquire/server';
import {
  invalidAction,
  verifySignedAction,
} from '../../packages/extension/src/policy.js';

const image = { mediaType: 'image/jpeg', data: 'AAAA', width: 2, height: 1 };
const snapshot = {
  protocolVersion: '0.1',
  id: 'snapshot-1',
  url: 'https://example.test/',
  title: 'Shop',
  text: 'Shop',
  targets: [],
  truncated: { text: false, targets: false },
};

test('ui.screenshot is opt-in and outside the generic catalog', () => {
  const ids = createGenericCapabilities().map((entry) => entry.id);
  assert.equal(ids.includes('ui.screenshot'), false);
  assert.deepEqual(
    createScreenshotCapabilities().map((entry) => [entry.id, entry.risk]),
    [['ui.screenshot', 'read_only']],
  );
});

test('the screenshot tool returns the driver image with its verification', async () => {
  const driver = {
    taken: [],
    async screenshot(tab) {
      this.taken.push(tab);
      return image;
    },
  };
  const { handlers, verifiers } = createGenericBindings({ driver });
  const context = { call: { callId: 'shot-1' } };
  await handlers['ui.screenshot']({ tab: 'tab2' }, context);
  assert.deepEqual(driver.taken, ['tab2']);
  assert.deepEqual(
    verifiers['ui.screenshot.verify']({ tab: 'tab2' }, context),
    {
      verified: true,
      evidence: { tab: 'tab2', width: 2, height: 1 },
      screenshot: image,
    },
  );
  await assert.rejects(
    createGenericBindings().handlers['ui.screenshot']({ tab: 'tab1' }, context),
    { code: 'UNSUPPORTED_TARGET' },
  );
});

test('the result schema bounds screenshots', () => {
  const result = {
    protocolVersion: '0.1',
    callId: 'call-1',
    capabilityId: 'ui.screenshot',
    status: 'success',
    code: 'VERIFIED',
    message: 'ok',
    evidence: {},
  };
  assert.equal(
    validateActionResult({ ...result, screenshot: image }).valid,
    true,
  );
  for (const bad of [
    { ...image, mediaType: 'image/png' },
    { ...image, data: 'not base64!' },
    { ...image, data: 'A'.repeat(100004) },
    { ...image, width: 5000 },
    { ...image, extra: true },
  ])
    assert.equal(
      validateActionResult({ ...result, screenshot: bad }).valid,
      false,
      JSON.stringify({ ...bad, data: bad.data.slice(0, 10) }),
    );
});

test('the extension policy takes signed screenshot requests per tab', async () => {
  assert.equal(invalidAction({ kind: 'screenshot', tab: 'tab1' }), undefined);
  assert.equal(
    invalidAction({ kind: 'screenshot', tab: 'tab1', nonce: 'a'.repeat(32) }),
    'BAD_REQUEST',
  );
  assert.equal(invalidAction({ kind: 'screenshot' }), 'BAD_REQUEST');
  // Declarations name the feature only when asked.
  const key = Buffer.alloc(32, 3).toString('base64');
  assert.deepEqual(
    siteDeclaration({ endpoint: '/chat', signingKey: key }).features,
    ['trustedInput'],
  );
  assert.deepEqual(
    siteDeclaration({ endpoint: '/chat', signingKey: key, screenshots: true })
      .features,
    ['trustedInput', 'screenshots'],
  );
  assert.equal(
    (
      await verifySignedAction({
        signature: undefined,
        publicKey: '',
        origin: 'http://shop.test',
        args: { kind: 'screenshot', tab: 'tab1' },
      })
    ).code,
    'UNSIGNED',
  );
});

test('the page driver asks the extension for a signed screenshot', async () => {
  const calls = [];
  const view = {
    document: {},
    location: { origin: 'http://shop.test' },
    MessageChannel,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
    addEventListener() {},
    postMessage(_data, _origin, [port]) {
      port.onmessage = ({ data }) => {
        calls.push(data);
        port.postMessage({ id: data.id, ok: true, screenshot: image });
      };
      port.postMessage({ type: 'pagesquire:hello-ack', version: 1 });
      view.port = port;
    },
  };
  const driver = createCompanionDriver({ view });
  const signature = { claims: '{}', value: `${'A'.repeat(86)}==` };
  const context = { signal: new AbortController().signal, call: { signature } };
  assert.deepEqual(await driver.screenshot('tab1', context), image);
  assert.deepEqual(calls[0].args, {
    kind: 'screenshot',
    tab: 'tab1',
    signature,
  });
  await assert.rejects(driver.screenshot('tab1', { ...context, call: {} }), {
    code: 'ACTION_FAILED',
  });
  view.port.close();
});

test('the engine forwards a screenshot once, only when enabled, and never stores it', async () => {
  const manifest = {
    schemaVersion: '0.1',
    capabilities: createScreenshotCapabilities(),
  };
  const ids = ['ui.screenshot'];
  for (const screenshots of [true, false]) {
    const received = [];
    const replies = [
      {
        text: 'Looking',
        emotion: 'thinking',
        finished: false,
        toolCalls: [
          { capabilityId: 'ui.screenshot', parameters: { tab: 'tab1' } },
        ],
      },
      { text: 'It is blue.', emotion: 'happy', finished: true, toolCalls: [] },
    ];
    const provider = {
      async complete(messages) {
        received.push(structuredClone(messages));
        return replies.shift();
      },
    };
    const engine = new ConversationEngine({ manifest, provider, screenshots });
    const first = await engine.handle(
      {
        protocolVersion: '0.1',
        requestId: 'r1',
        message: 'What colour is the button?',
        snapshot,
        capabilityIds: ids,
      },
      null,
      ids,
    );
    const call = first.reply.response.toolCalls[0];
    const second = await engine.handle(
      {
        protocolVersion: '0.1',
        requestId: 'r2',
        conversationId: first.state.id,
        snapshot,
        capabilityIds: ids,
        result: {
          protocolVersion: '0.1',
          callId: call.callId,
          capabilityId: 'ui.screenshot',
          status: 'success',
          code: 'VERIFIED',
          message: 'ok',
          evidence: { tab: 'tab1', width: 2, height: 1 },
          screenshot: image,
        },
      },
      first.state,
      ids,
    );
    assert.equal(second.reply.response.text, 'It is blue.');
    const last = received[1].at(-1);
    if (screenshots)
      assert.deepEqual(last.content[1], {
        type: 'image_url',
        image_url: { url: 'data:image/jpeg;base64,AAAA' },
      });
    else assert.equal(typeof last.content, 'string');
    assert.equal(
      JSON.stringify(received[1]).includes('base64,AAAA'),
      screenshots,
    );
    // Stored history keeps the outcome, never the image.
    assert.equal(JSON.stringify(second.state).includes('AAAA'), false);
  }
});
