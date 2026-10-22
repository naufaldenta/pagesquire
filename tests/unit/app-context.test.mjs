import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '../../packages/core/dist/index.js';
import * as protocol from '../../packages/protocol/dist/index.js';
import {
  AssistantClient,
  createHttpTransport,
} from '../../packages/client/dist/index.js';
import { ConversationEngine } from '../../packages/server/dist/index.js';
import { Ajv2020 } from 'ajv/dist/2020.js';

const definition = {
  id: 'app.toggle',
  description: 'Set the public panel state.',
  execution: 'browser',
  handler: 'toggle',
  verification: { handler: 'verifyToggle' },
  risk: 'reversible',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
const manifest = { schemaVersion: '0.1', capabilities: [definition] };
const snapshot = {
  protocolVersion: '0.1',
  id: 'snapshot',
  url: 'https://example.test/',
  title: '',
  text: '',
  targets: [],
  truncated: { text: false, targets: false },
};
const request = {
  protocolVersion: '0.1',
  requestId: 'first',
  message: 'Open the panel.',
  snapshot,
  capabilityIds: [definition.id],
};
const context = (status = 'available', value = 'public-marker') => ({
  schemaVersion: 1,
  fields: [{ name: 'view', value }],
  availability: [{ capabilityId: definition.id, status }],
});
const final = {
  text: 'Checked.',
  emotion: 'happy',
  finished: true,
  toolCalls: [],
};
const proposal = {
  text: 'Checking.',
  emotion: 'thinking',
  finished: false,
  toolCalls: [{ capabilityId: definition.id, parameters: {} }],
};

function fixture(options = {}) {
  let executions = 0,
    verifications = 0;
  const registry = new core.CapabilityRegistry(manifest, {
    handlers: { toggle: () => executions++ },
    verifiers: {
      verifyToggle: () => {
        verifications++;
        return { verified: true };
      },
    },
    parameters: {
      [definition.id]: {
        schema: definition.inputSchema,
        validate: (input) => Object.keys(input).length === 0,
      },
    },
  });
  const appContext = new core.AppContext({ registry, ...options });
  const observer = {
    document: { URL: snapshot.url, defaultView: {} },
    observe: () => structuredClone(snapshot),
    requireSnapshot: () => snapshot,
  };
  const runtime = new core.BrowserRuntime({ registry, observer, appContext });
  return {
    registry,
    appContext,
    runtime,
    executions: () => executions,
    verifications: () => verifications,
  };
}

test('optional app context is closed, bounded and rejects duplicate field/capability identities', () => {
  assert.equal(protocol.validateChatRequest(request).valid, true);
  assert.equal(
    protocol.validateChatRequest({ ...request, appContext: context() }).valid,
    true,
  );
  for (const appContext of [
    { ...context(), secret: 'no' },
    { ...context(), schemaVersion: 2 },
    {
      ...context(),
      fields: [{ name: 'nested', value: { entireStore: true } }],
    },
    { ...context(), fields: [{ name: 'too_long', value: 'x'.repeat(201) }] },
    {
      ...context(),
      fields: [
        { name: 'view', value: true },
        { name: 'view', value: false },
      ],
    },
    {
      ...context(),
      availability: [
        { capabilityId: definition.id, status: 'available' },
        { capabilityId: definition.id, status: 'disabled' },
      ],
    },
    {
      ...context(),
      availability: [{ capabilityId: definition.id, status: 'grant_admin' }],
    },
    {
      ...context(),
      fields: Array.from({ length: 21 }, (_, index) => ({
        name: `field_${index}`,
        value: true,
      })),
    },
  ])
    assert.equal(
      protocol.validateChatRequest({ ...request, appContext }).valid,
      false,
    );
  const large = {
    schemaVersion: 1,
    fields: Array.from({ length: 20 }, (_, index) => ({
      name: `field_${index}`,
      value: '😀'.repeat(200),
    })),
    availability: Array.from({ length: 100 }, (_, index) => ({
      capabilityId: `app.action_${index}`,
      status: 'disabled',
    })),
  };
  assert.equal(protocol.validateAppContext(large).valid, false);
});

test('only explicitly public typed primitive fields are read, copied and returned immutably', () => {
  let reads = 0;
  const field = {
    public: true,
    type: 'enum',
    values: ['gallery', 'article'],
    read: () => {
      reads++;
      return 'gallery';
    },
  };
  const { appContext, executions } = fixture({
    fields: {
      view: field,
      count: { public: true, type: 'number', min: 0, max: 10, read: () => 3 },
      panel_open: { public: true, type: 'boolean', read: () => false },
    },
  });
  assert.equal(reads, 0);
  field.read = () => 'invalid';
  const value = appContext.snapshot();
  assert.deepEqual(value.fields, [
    { name: 'view', value: 'gallery' },
    { name: 'count', value: 3 },
    { name: 'panel_open', value: false },
  ]);
  assert.equal(protocol.validateAppContext(value).valid, true);
  assert.throws(() => {
    value.fields[0].value = 'changed';
  }, TypeError);
  assert.equal(executions(), 0);
});

test('field configuration/getters and unsafe runtime values fail closed without private error details', () => {
  for (const spec of [
    { type: 'string', read: () => 'secret' },
    { public: false, type: 'boolean', read: () => true },
    { public: true, type: 'object', read: () => ({}) },
    { public: true, type: 'string', maxLength: 201, read: () => '' },
    { public: true, type: 'enum', values: [], read: () => '' },
    { public: true, type: 'number', min: 5, max: 2, read: () => 3 },
  ])
    assert.throws(() => fixture({ fields: { view: spec } }), {
      code: 'INVALID_OPTIONS',
    });
  let getter = false;
  assert.throws(
    () =>
      fixture({
        fields: {
          get view() {
            getter = true;
            return {};
          },
        },
      }),
    { code: 'INVALID_OPTIONS' },
  );
  assert.equal(getter, false);
  for (const read of [
    () => {
      throw Error('private-detail');
    },
    () => ({ private: 'store' }),
    () => NaN,
    () => 'x'.repeat(9),
  ]) {
    const { appContext } = fixture({
      fields: { view: { public: true, type: 'string', maxLength: 8, read } },
    });
    assert.throws(
      () => appContext.snapshot(),
      (error) =>
        error.code === 'APP_CONTEXT_INVALID' &&
        !error.message.includes('private-detail'),
    );
  }
});

test('availability uses fixed statuses, honors preparation and sanitizes failed or async checks', async () => {
  for (const [callback, expected] of [
    [() => 'needs_preparation', 'needs_preparation'],
    [() => 'disabled', 'disabled'],
    [
      () => {
        throw Error('private-detail');
      },
      'check_failed',
    ],
    [() => 'granted', 'check_failed'],
    [
      async () => {
        throw Error('private async detail');
      },
      'check_failed',
    ],
  ]) {
    const { appContext } = fixture({
      availability: { [definition.id]: callback },
    });
    assert.equal(appContext.checkAvailability(definition.id), expected);
    assert.equal(appContext.checkAvailability('app.unknown'), 'not_checked');
    assert.equal(appContext.snapshot().availability[0].status, expected);
  }
  await new Promise(setImmediate);
  assert.throws(
    () => fixture({ availability: { 'app.unknown': () => 'available' } }),
    { code: 'INVALID_OPTIONS' },
  );
});

test('runtime rechecks availability inside the queued handler, without executing or replaying a denied action', async () => {
  let available = true;
  const f = fixture({
    availability: {
      [definition.id]: () => (available ? 'available' : 'disabled'),
    },
  });
  const call = {
    protocolVersion: '0.1',
    callId: 'call',
    snapshotId: snapshot.id,
    capabilityId: definition.id,
    parameters: {},
  };
  const pending = f.runtime.execute(call);
  available = false;
  const blocked = await pending;
  assert.equal(blocked.code, 'CAPABILITY_UNAVAILABLE');
  assert.equal(f.executions(), 0);
  assert.equal(f.verifications(), 0);
  available = true;
  assert.deepEqual(await f.runtime.execute(call), blocked);
  assert.equal(
    (await f.runtime.execute({ ...call, callId: 'fresh' })).status,
    'success',
  );
  assert.equal(f.executions(), 1);
});

test('client sends fresh context on every round without dropping registered capability IDs', async () => {
  let state = 'before';
  const f = fixture({
    fields: { view: { public: true, type: 'string', read: () => state } },
    availability: {
      [definition.id]: () =>
        state === 'after' ? 'not_applicable' : 'needs_preparation',
    },
  });
  const received = [];
  const client = new AssistantClient({
    runtime: f.runtime,
    transport: async (body) => {
      received.push(body);
      if (body.result)
        return {
          protocolVersion: '0.1',
          conversationId: 'conversation',
          response: { protocolVersion: '0.1', ...final },
        };
      queueMicrotask(() => {
        state = 'after';
      });
      return {
        protocolVersion: '0.1',
        conversationId: 'conversation',
        response: {
          protocolVersion: '0.1',
          ...proposal,
          toolCalls: [
            {
              protocolVersion: '0.1',
              callId: 'client-call',
              capabilityId: definition.id,
              snapshotId: snapshot.id,
              parameters: {},
            },
          ],
        },
      };
    },
  });
  await client.send('Open it.');
  assert.equal(received[0].appContext.fields[0].value, 'before');
  assert.equal(received[1].appContext.fields[0].value, 'after');
  assert.deepEqual(received[1].capabilityIds, [definition.id]);
  assert.equal(received[1].result.code, 'CAPABILITY_UNAVAILABLE');
  assert.equal(f.executions(), 0);
});

test('Node forwards only current untrusted context ephemerally and filters future proposals', async () => {
  const received = [];
  const engine = new ConversationEngine({
    manifest,
    provider: {
      async complete(messages, capabilities) {
        received.push({ messages, capabilities });
        return final;
      },
    },
  });
  const first = await engine.handle(
    { ...request, appContext: context('disabled') },
    null,
    [definition.id],
  );
  assert.equal(received[0].capabilities.length, 0);
  assert.equal(
    JSON.parse(received[0].messages.at(-1).content).untrustedAppContext
      .fields[0].value,
    'public-marker',
  );
  assert.doesNotMatch(
    JSON.stringify(first.state),
    /public-marker|untrustedAppContext/,
  );
  await engine.handle(
    { ...request, requestId: 'next', conversationId: first.state.id },
    first.state,
    [definition.id],
  );
  assert.equal(received[1].capabilities.length, 1);
  assert.doesNotMatch(JSON.stringify(received[1]), /public-marker/);
});

test('Node accepts a pending result when its capability becomes unavailable afterward', async () => {
  let calls = 0;
  const engine = new ConversationEngine({
    manifest,
    provider: {
      async complete() {
        return ++calls === 1 ? proposal : final;
      },
    },
  });
  const first = await engine.handle(
    { ...request, appContext: context('needs_preparation') },
    null,
    [definition.id],
  );
  const call = first.reply.response.toolCalls[0];
  const next = await engine.handle(
    {
      protocolVersion: '0.1',
      requestId: 'second',
      conversationId: first.state.id,
      snapshot,
      capabilityIds: [definition.id],
      appContext: context('not_applicable'),
      result: {
        protocolVersion: '0.1',
        callId: call.callId,
        capabilityId: call.capabilityId,
        status: 'success',
        code: 'VERIFIED',
        message: 'Checked.',
        evidence: {},
      },
    },
    first.state,
    [definition.id],
  );
  assert.equal(next.reply.response.finished, true);
  assert.equal(next.state.attempts, 2);
});

test('Node never grants permission from context and charges unavailable model proposals without retry', async () => {
  for (const [allowed, status, expected] of [
    [[definition.id], 'loading', 'CAPABILITY_UNAVAILABLE'],
    [[], 'available', 'CAPABILITY_DENIED'],
  ]) {
    let calls = 0,
      checkpoint;
    const engine = new ConversationEngine({
      manifest,
      provider: {
        async complete() {
          calls++;
          return proposal;
        },
      },
    });
    await assert.rejects(
      engine.handle(
        { ...request, appContext: context(status) },
        null,
        allowed,
        async (state) => {
          checkpoint = state;
        },
      ),
      { code: expected },
    );
    assert.equal(calls, 1);
    assert.equal(checkpoint.attempts, 1);
    assert.equal(checkpoint.steps, 0);
  }
});

test('invalid context or cancellation during a public field read never dispatches transport', async () => {
  for (const cancel of [false, true]) {
    let client,
      calls = 0;
    const f = fixture({
      fields: {
        view: {
          public: true,
          type: 'string',
          read: () => {
            if (cancel) client.cancel();
            else throw Error('private field failure');
            return 'view';
          },
        },
      },
    });
    client = new AssistantClient({
      runtime: f.runtime,
      transport: async () => {
        calls++;
        throw Error('Must not dispatch');
      },
    });
    await client.send('Open it.');
    assert.equal(calls, 0);
    assert.doesNotMatch(JSON.stringify(client.state), /private field failure/);
  }
});

test('contextual unavailability has safe actionable HTTP feedback, not an expired-conversation message', async () => {
  const transport = createHttpTransport({
    endpoint: '/chat',
    baseUrl: snapshot.url,
    csrfToken: () => 'token',
    fetch: async () =>
      Response.json(
        {
          error: { code: 'CAPABILITY_UNAVAILABLE', message: 'private detail' },
        },
        { status: 409 },
      ),
  });
  await assert.rejects(
    transport(request, new AbortController().signal),
    (error) =>
      error.code === 'CAPABILITY_UNAVAILABLE' &&
      error.message.includes('current page state') &&
      !/expired|private detail/.test(error.message),
  );
});

test('opt-in wire extension requires updated servers while old payloads remain accepted', () => {
  const old = structuredClone(protocol.chatRequestSchema);
  delete old.properties.appContext;
  const ajv = new Ajv2020({ strict: true });
  for (const [name, schema] of Object.entries(protocol.protocolSchemas)) {
    if (name !== 'chatRequest') ajv.addSchema(schema);
  }
  const oldValidate = ajv.compile(old);
  assert.equal(oldValidate(request), true);
  assert.equal(oldValidate({ ...request, appContext: context() }), false);
  assert.equal(protocol.validateChatRequest(request).valid, true);
  assert.equal(
    protocol.validateChatRequest({ ...request, appContext: context() }).valid,
    true,
  );
});
