import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BrowserDriver,
  BrowserRuntime,
  CapabilityRegistry,
  createControlBindings,
  createPageBindings,
  createPageCapabilities,
} from '../../packages/core/dist/index.js';
import { ConversationEngine } from '../../packages/server/dist/index.js';
import { validateManifest } from '@pagesquire/protocol';
import { SpeechOutput } from '../../packages/client/dist/index.js';

test('unavailable browser voice discovery cannot leak an error or trigger an action', async () => {
  let calls = 0;
  const speech = new SpeechOutput({
    window: {
      speechSynthesis: {
        speaking: false,
        getVoices() {
          throw Error('private device detail');
        },
        speak() {
          calls++;
        },
      },
      SpeechSynthesisUtterance: class {},
    },
  });
  speech.setEnabled(true);
  assert.equal(await speech.speak('A final answer.'), false);
  assert.equal(calls, 0);
  speech.dispose();
});

test('page capabilities have closed scope/mode/offset schemas and require real control postconditions', () => {
  const capabilities = createPageCapabilities(['article', 'guide']);
  assert.equal(
    validateManifest({ schemaVersion: '0.1', capabilities }).valid,
    true,
  );
  assert.deepEqual(capabilities[0].inputSchema.properties.scope.enum, [
    'article',
    'guide',
  ]);
  for (const scopes of [
    [],
    ['article', 'article'],
    ['#secret'],
    Array(101).fill('scope'),
  ])
    assert.throws(() => createPageCapabilities(scopes));
  assert.throws(() => createControlBindings([]));
  assert.throws(() =>
    createControlBindings([{ definition: capabilities[0], target() {} }]),
  );
  for (const durationMs of [-1, 1501, 0.5, NaN])
    assert.throws(() => new BrowserDriver({ observer: {}, durationMs }));
});

test('control bindings reject implicit and invalid-type submit buttons using the native button type', async () => {
  for (const type of ['submit', 'reset']) {
    let clicks = 0;
    const target = {
      tagName: 'BUTTON',
      type,
      isConnected: true,
      closest: (selector) => selector === 'form',
      matches(selector) {
        return selector === 'button' || selector.startsWith('button,input');
      },
      click() {
        clicks++;
      },
    };
    const definition = createPageCapabilities(['article'])[2];
    const bindings = createControlBindings([
      { definition, target: () => target, isApplied: () => false },
    ]);
    await assert.rejects(
      bindings.handlers[definition.handler](
        {},
        {
          signal: new AbortController().signal,
          call: { snapshotId: 'current' },
          observer: {
            requireSnapshot() {},
            isVisible: () => true,
            isExcluded: () => false,
          },
          async present() {},
        },
      ),
      (error) => error.code === 'TARGET_NOT_ALLOWED',
    );
    assert.equal(clicks, 0);
  }
});

function presentationFixture(presentation, excluded = false) {
  const definition = createPageCapabilities(['article'])[2];
  const document = { URL: 'https://example.test/' };
  const target = { ownerDocument: document, isConnected: true };
  const snapshot = {
    protocolVersion: '0.1',
    id: 'snapshot',
    url: document.URL,
    title: '',
    text: '',
    targets: [],
    truncated: { text: false, targets: false },
  };
  let executions = 0;
  const observer = {
    document,
    requireSnapshot: () => snapshot,
    observe: () => snapshot,
    isExcluded: () => excluded,
    isVisible: () => true,
  };
  const registry = new CapabilityRegistry(
    { schemaVersion: '0.1', capabilities: [definition] },
    {
      handlers: {
        [definition.handler]: async (_p, context) => {
          await context.present(target, 'click');
          executions++;
        },
      },
      verifiers: {
        [definition.verification.handler]: () => ({
          verified: executions === 1,
        }),
      },
      parameters: {
        [definition.id]: {
          schema: definition.inputSchema,
          validate: () => true,
        },
      },
    },
  );
  const runtime = new BrowserRuntime({
    observer,
    registry,
    presentation,
    navigation: { mode: 'spa', navigate() {} },
    timeoutMs: 1000,
  });
  return {
    runtime,
    executions: () => executions,
    call: {
      protocolVersion: '0.1',
      callId: 'call',
      snapshotId: 'snapshot',
      capabilityId: definition.id,
      parameters: { scope: 'article' },
    },
  };
}

test('presentation cannot bypass private targets, fabricate verification or replay an action', async () => {
  let points = 0,
    clears = 0;
  const presentation = {
    async present() {
      points++;
    },
    clear() {
      clears++;
    },
  };
  const denied = presentationFixture(presentation, true);
  assert.equal(
    (await denied.runtime.execute(denied.call)).code,
    'TARGET_MISSING',
  );
  assert.equal(denied.executions(), 0);
  assert.equal(points, 0);
  const allowed = presentationFixture(presentation);
  assert.equal((await allowed.runtime.execute(allowed.call)).status, 'success');
  assert.equal((await allowed.runtime.execute(allowed.call)).status, 'success');
  assert.equal(allowed.executions(), 1);
  assert.equal(points, 1);
  assert.equal(clears, 2);
});

test('cancelling a presentation that ignores abort prevents the subsequent host mutation', async () => {
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const presentation = {
    present() {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    clear() {},
  };
  const fixture = presentationFixture(presentation);
  const result = fixture.runtime.execute(fixture.call);
  await ready;
  fixture.runtime.cancel();
  assert.equal((await result).status, 'cancelled');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.executions(), 0);
});

test('reading verifies fresh content and URL, consumes transient evidence and cannot succeed without a read', async () => {
  let text = 'Public article';
  const root = {};
  const context = {
    signal: new AbortController().signal,
    call: { callId: 'read-1' },
    document: { URL: 'https://example.test/article' },
    observer: {
      readContent: () => ({ text, truncated: false, nextOffset: null }),
    },
  };
  const bindings = createPageBindings({ scopes: { article: () => root } });
  assert.ok(
    !bindings.capabilities.some(
      (definition) => definition.id === 'page.highlight',
    ),
  );
  const parameters = { scope: 'article', mode: 'summary', offset: 0 };
  assert.equal(
    bindings.verifiers['page.read.verify'](parameters, context).verified,
    false,
  );
  await bindings.handlers['page.read'](parameters, context);
  text = 'Changed while reading';
  assert.equal(
    bindings.verifiers['page.read.verify'](parameters, context).verified,
    false,
  );
  await bindings.handlers['page.read'](parameters, context);
  context.document.URL += '/changed';
  assert.equal(
    bindings.verifiers['page.read.verify'](parameters, context).verified,
    false,
  );
  await bindings.handlers['page.read'](parameters, context);
  const result = bindings.verifiers['page.read.verify'](parameters, context);
  assert.equal(result.verified, true);
  assert.equal(result.evidence.text, text);
  assert.equal(
    bindings.verifiers['page.read.verify'](parameters, context).verified,
    false,
  );
  await assert.rejects(
    () => bindings.handlers['page.highlight'](parameters, context),
    { code: 'PRESENTATION_UNAVAILABLE' },
  );
});

test('open/read/summary stays one verified server conversation without replay or hidden model retry', async () => {
  const open = {
    ...createPageCapabilities(['article'])[2],
    id: 'content.open',
    handler: 'open',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    verification: { handler: 'verifyOpen' },
  };
  const read = createPageCapabilities(['article'])[0];
  let calls = 0;
  const engine = new ConversationEngine({
    manifest: { schemaVersion: '0.1', capabilities: [open, read] },
    provider: {
      async complete(messages) {
        calls++;
        assert.match(messages[0].content, /preserve the entire user goal/);
        assert.match(
          messages[0].content,
          /visual scrolling does not prove reading completeness/,
        );
        assert.match(
          messages[0].content,
          /actionable=false blocks generic DOM interaction only/,
        );
        if (calls === 3) {
          assert.ok(
            messages.some((message) =>
              message.content.includes('verified article text'),
            ),
          );
          return {
            text: 'A partial synthetic summary, not a complete article.',
            emotion: 'happy',
            finished: true,
            toolCalls: [],
          };
        }
        return {
          text: 'Checking…',
          emotion: 'thinking',
          finished: false,
          toolCalls: [
            {
              capabilityId: calls === 1 ? open.id : read.id,
              parameters:
                calls === 1
                  ? {}
                  : { scope: 'article', mode: 'summary', offset: 0 },
            },
          ],
        };
      },
    },
  });
  const snapshot = {
    protocolVersion: '0.1',
    id: 's-1',
    url: 'https://example.test/',
    title: '',
    text: 'Untrusted',
    targets: [],
    truncated: { text: false, targets: false },
  };
  const request = {
    protocolVersion: '0.1',
    requestId: 'request-1',
    message: 'Open the article, read it, then summarize.',
    snapshot,
    capabilityIds: [open.id, read.id],
  };
  let next = await engine.handle(request, null, request.capabilityIds);
  const id = next.state.id;
  for (let index = 0; index < 2; index++) {
    assert.equal(next.reply.response.finished, false);
    const call = next.reply.response.toolCalls[0];
    assert.equal(call.capabilityId, index === 0 ? open.id : read.id);
    next = await engine.handle(
      {
        ...request,
        message: undefined,
        requestId: `result-${index}`,
        conversationId: id,
        snapshot: {
          ...snapshot,
          id: `s-${index + 2}`,
          url: 'https://example.test/article',
        },
        result: {
          protocolVersion: '0.1',
          callId: call.callId,
          capabilityId: call.capabilityId,
          status: 'success',
          code: 'VERIFIED',
          message: 'Verified',
          evidence: index
            ? {
                text: 'verified article text',
                truncated: true,
                nextOffset: null,
              }
            : {},
        },
      },
      next.state,
      request.capabilityIds,
    );
  }
  assert.equal(next.reply.response.finished, true);
  assert.equal(next.state.id, id);
  assert.equal(calls, 3);
  assert.equal(next.state.attempts, 3);
});
