import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '../../packages/core/dist/index.js';
import { AssistantClient } from '../../packages/client/dist/index.js';

const definition = {
  id: 'app.toggle',
  description: 'Set the public panel state.',
  execution: 'browser',
  handler: 'toggle',
  verification: { handler: 'verifyToggle' },
  risk: 'reversible',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
const snapshot = {
  protocolVersion: '0.1',
  id: 'snapshot',
  url: 'https://example.test/',
  title: '',
  text: 'private-page-marker',
  targets: [],
  truncated: { text: false, targets: false },
};
const call = {
  protocolVersion: '0.1',
  callId: 'action',
  capabilityId: definition.id,
  snapshotId: snapshot.id,
  parameters: {},
};
function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}
function fixture(options = {}) {
  let executions = 0,
    verifications = 0;
  const registry = new core.CapabilityRegistry(
    {
      schemaVersion: '0.1',
      capabilities: [
        {
          ...definition,
          ...(options.consequential ? { risk: 'consequential' } : {}),
        },
      ],
    },
    {
      handlers: {
        toggle: (...args) => {
          executions++;
          return options.execute?.(...args);
        },
      },
      verifiers: {
        verifyToggle: (...args) => {
          verifications++;
          return (
            options.verify?.(...args) ?? {
              verified: true,
              evidence: { private: 'private-evidence-marker' },
            }
          );
        },
      },
      parameters: {
        [definition.id]: {
          schema: definition.inputSchema,
          validate: (p) => Object.keys(p).length === 0,
        },
      },
    },
  );
  const observer = {
    document: { URL: snapshot.url, defaultView: {} },
    observe: () => structuredClone(snapshot),
    requireSnapshot: () => {
      if (options.stale)
        throw new core.PageSquireError(
          'STALE_SNAPSHOT',
          'private-error-marker',
        );
      return snapshot;
    },
  };
  const runtime = new core.BrowserRuntime({
    observer,
    registry,
    ...(options.unavailable
      ? {
          appContext: new core.AppContext({
            registry,
            availability: { [definition.id]: () => 'disabled' },
          }),
        }
      : {}),
    ...options.runtime,
  });
  return {
    runtime,
    registry,
    executions: () => executions,
    verifications: () => verifications,
  };
}
const stages = (events) => events.map((event) => event.stage);

test('progress follows actual handler and verifier entry, never a premature success', async () => {
  const entered = deferred(),
    executed = deferred(),
    verifying = deferred(),
    verified = deferred();
  const events = [];
  const f = fixture({
    execute: () => {
      entered.resolve();
      return executed.promise;
    },
    verify: () => {
      verifying.resolve();
      return verified.promise;
    },
  });
  const pending = f.runtime.execute(call, {
    onActionProgress: (event) => events.push(event),
  });
  await entered.promise;
  assert.deepEqual(stages(events), ['checking', 'executing']);
  executed.resolve();
  await verifying.promise;
  assert.deepEqual(stages(events), ['checking', 'executing', 'verifying']);
  verified.resolve({
    verified: true,
    evidence: { private: 'private-evidence-marker' },
  });
  assert.equal((await pending).status, 'success');
  assert.deepEqual(stages(events), [
    'checking',
    'executing',
    'verifying',
    'verified',
  ]);
  assert.equal(events.at(-1).code, 'VERIFIED');
  for (const event of events) {
    assert.equal(Object.isFrozen(event), true);
    assert.ok(
      Object.keys(event).every((key) =>
        ['callId', 'capabilityId', 'stage', 'code'].includes(key),
      ),
    );
  }
  assert.doesNotMatch(JSON.stringify(events), /private-/);
});

test('preflight denial has no executing/verifying event and never leaks raw errors', async () => {
  for (const [options, input, code] of [
    [{ stale: true }, call, 'STALE_SNAPSHOT'],
    [{ unavailable: true }, call, 'CAPABILITY_UNAVAILABLE'],
    [{ consequential: true }, call, 'CONFIRMATION_REQUIRED'],
    [{}, { ...call, capabilityId: 'missing.capability' }, 'UNKNOWN_CAPABILITY'],
    [{}, { ...call, parameters: { private: 'secret' } }, 'INVALID_PARAMETERS'],
  ]) {
    const events = [],
      f = fixture(options);
    assert.equal(
      (
        await f.runtime.execute(input, {
          onActionProgress: (e) => events.push(e),
        })
      ).code,
      code,
    );
    assert.deepEqual(stages(events), ['checking', 'failed']);
    assert.equal(f.executions(), 0);
    assert.equal(f.verifications(), 0);
    assert.doesNotMatch(JSON.stringify(events), /private-|secret/);
  }
});

test('unverified, invalid verifier and unknown host error get distinct sanitized terminal progress', async () => {
  for (const [options, stage, code] of [
    [
      { verify: () => ({ verified: false }) },
      'unverified',
      'POSTCONDITION_FAILED',
    ],
    [{ verify: () => ({ verified: 'yes' }) }, 'failed', 'INVALID_VERIFICATION'],
    [
      {
        execute: () => {
          throw new core.PageSquireError(
            'PRIVATE_ERROR_MARKER',
            'private-error-marker',
          );
        },
      },
      'failed',
      'ACTION_FAILED',
    ],
  ]) {
    const events = [],
      f = fixture(options);
    await f.runtime.execute(call, { onActionProgress: (e) => events.push(e) });
    assert.equal(events.at(-1).stage, stage);
    assert.equal(events.at(-1).code, code);
    assert.doesNotMatch(JSON.stringify(events), /private-|PRIVATE_ERROR/);
  }
});

test('cached replay never claims a new execution or verification; conflicting reuse is rejected', async () => {
  const f = fixture(),
    first = [],
    replay = [],
    conflict = [];
  await f.runtime.execute(call, { onActionProgress: (e) => first.push(e) });
  await f.runtime.execute(call, { onActionProgress: (e) => replay.push(e) });
  assert.deepEqual(stages(replay), ['replayed']);
  await f.runtime.execute(
    { ...call, parameters: { changed: true } },
    { onActionProgress: (e) => conflict.push(e) },
  );
  assert.deepEqual(stages(conflict), ['failed']);
  assert.equal(conflict[0].code, 'CALL_ID_REUSED');
  assert.equal(f.executions(), 1);
  assert.equal(f.verifications(), 1);
});

test('progress observers cannot throw or reject into execution, and observer cancellation precedes the handler', async () => {
  const base = fixture();
  const guarded = new core.BrowserRuntime({
    observer: base.runtime.observer,
    registry: base.registry,
    get onActionProgress() {
      throw Error('private-getter-marker');
    },
  });
  assert.equal((await guarded.execute(call)).status, 'success');
  let f;
  f = fixture({
    runtime: {
      onActionProgress: (event) => {
        if (event.stage === 'executing') f.runtime.cancel();
        throw Error('private-observer');
      },
    },
  });
  const events = [];
  const result = await f.runtime.execute(call, {
    onActionProgress: async (e) => {
      events.push(e);
      throw Error('private-rejection');
    },
  });
  assert.equal(result.status, 'cancelled');
  assert.deepEqual(stages(events), ['checking', 'executing', 'cancelled']);
  assert.equal(f.executions(), 0);
  assert.equal(f.verifications(), 0);
  await new Promise((resolve) => setImmediate(resolve));
});

test('timeout and cancellation settle once and ignore late uncooperative handler resolution', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const timed of [false, true]) {
    const entered = deferred(),
      late = deferred(),
      events = [];
    const f = fixture({
      execute: () => {
        entered.resolve();
        return late.promise;
      },
      runtime: { timeoutMs: timed ? 15 : 5000 },
    });
    const pending = f.runtime.execute(call, {
      onActionProgress: (e) => events.push(e),
    });
    await entered.promise;
    if (timed) t.mock.timers.tick(15);
    else f.runtime.cancel();
    const result = await pending;
    assert.equal(result.code, timed ? 'TIMEOUT' : 'CANCELLED');
    assert.equal(events.at(-1).stage, timed ? 'timed_out' : 'cancelled');
    const before = structuredClone(events);
    late.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, before);
    assert.equal(f.verifications(), 0);
  }
});

test('a timed-out handler that ignores its signal blocks new actions until it settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = deferred(),
    late = deferred();
  const f = fixture({
    execute: () => {
      entered.resolve();
      return late.promise;
    },
    runtime: { timeoutMs: 15 },
  });
  const pending = f.runtime.execute(call);
  await entered.promise;
  t.mock.timers.tick(15);
  assert.equal((await pending).code, 'TIMEOUT');
  const blocked = await f.runtime.execute({ ...call, callId: 'second' });
  assert.equal(blocked.code, 'BUSY');
  assert.equal(f.executions(), 1);
  late.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  const next = await f.runtime.execute({ ...call, callId: 'third' });
  assert.equal(next.code, 'VERIFIED');
  assert.equal(f.executions(), 2);
});

test('resetSession starts a fresh action budget without lifting the active-action guard', async () => {
  const f = fixture({ runtime: { maxActions: 1 } });
  assert.equal((await f.runtime.execute(call)).code, 'VERIFIED');
  const limited = await f.runtime.execute({ ...call, callId: 'second' });
  assert.equal(limited.code, 'ACTION_LIMIT');
  f.runtime.resetSession();
  const fresh = await f.runtime.execute({ ...call, callId: 'third' });
  assert.equal(fresh.code, 'VERIFIED');
  const entered = deferred(),
    release = deferred();
  const busy = fixture({
    execute: () => {
      entered.resolve();
      return release.promise;
    },
  });
  const pending = busy.runtime.execute(call);
  await entered.promise;
  assert.throws(() => busy.runtime.resetSession(), { code: 'BUSY' });
  release.resolve();
  assert.equal((await pending).code, 'VERIFIED');
});

function assistant(runtime, transport, options = {}) {
  return new AssistantClient({ runtime, transport, ...options });
}
function reply(request, finished = false) {
  return {
    protocolVersion: '0.1',
    conversationId: 'conversation',
    response: {
      protocolVersion: '0.1',
      text: finished ? 'Done' : 'private-premature-success',
      emotion: 'happy',
      finished,
      toolCalls: finished
        ? []
        : [
            {
              ...call,
              snapshotId: request.snapshot.id,
              callId: request.requestId,
            },
          ],
    },
  };
}

test('client keeps a bounded local action history across turns, clears on reset and never uploads it', async () => {
  const f = fixture(),
    requests = [];
  const client = assistant(f.runtime, async (request) => {
    requests.push(request);
    return reply(request, Boolean(request.result));
  });
  for (let index = 0; index < 23; index++) await client.send('Set panel');
  assert.equal(client.state.actionProgress.length, 20);
  for (const entry of client.state.actionProgress) {
    assert.deepEqual(entry.stages, [
      'checking',
      'executing',
      'verifying',
      'verified',
    ]);
    assert.equal(entry.stage, 'verified');
    assert.equal(Object.isFrozen(entry), true);
  }
  assert.ok(
    requests.every((request) => !Object.hasOwn(request, 'actionProgress')),
  );
  assert.doesNotMatch(JSON.stringify(client.state.actionProgress), /private-/);
  client.reset();
  assert.deepEqual(client.state.actionProgress, []);
});

test('a later provider failure never downgrades a genuinely verified action', async () => {
  const f = fixture();
  const client = assistant(f.runtime, async (request) => {
    if (request.result)
      throw new core.PageSquireError(
        'PROVIDER_UNAVAILABLE',
        'Provider unavailable',
      );
    return reply(request);
  });
  await client.send('Set panel');
  assert.equal(client.state.actionProgress.at(-1).stage, 'verified');
  assert.equal(client.state.emotion, 'confused');
});

test('busy, action limits and malformed calls never announce fresh execution', async () => {
  const entered = deferred(),
    release = deferred();
  const f = fixture({
    execute: () => {
      entered.resolve();
      return release.promise;
    },
    runtime: { maxActions: 1 },
  });
  const pending = f.runtime.execute(call);
  await entered.promise;
  const events = [];
  assert.equal(
    (
      await f.runtime.execute(
        { ...call, callId: 'second' },
        { onActionProgress: (e) => events.push(e) },
      )
    ).code,
    'BUSY',
  );
  release.resolve();
  await pending;
  assert.equal(
    (
      await f.runtime.execute(
        { ...call, callId: 'second' },
        { onActionProgress: (e) => events.push(e) },
      )
    ).code,
    'ACTION_LIMIT',
  );
  await f.runtime.execute(
    { private: 'private-invalid-marker' },
    { onActionProgress: (e) => events.push(e) },
  );
  assert.deepEqual(stages(events), ['failed', 'failed', 'failed']);
  assert.equal(events.at(-1).code, 'INVALID_CALL');
  assert.doesNotMatch(JSON.stringify(events), /private-/);
  assert.equal(f.executions(), 1);
});

test('client timeout/cancellation close only the active attempt and ignore late work after reset', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const timed of [false, true]) {
    const entered = deferred(),
      late = deferred();
    const f = fixture({
      execute: () => {
        entered.resolve();
        return late.promise;
      },
    });
    const client = assistant(
      f.runtime,
      async (request) => reply(request, Boolean(request.result)),
      { timeoutMs: 100 },
    );
    const pending = client.send('Set panel');
    await entered.promise;
    if (timed) t.mock.timers.tick(100);
    else client.cancel();
    await pending;
    assert.equal(
      client.state.actionProgress.at(-1).stage,
      timed ? 'timed_out' : 'cancelled',
    );
    client.reset();
    const reset = client.state;
    late.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(client.state, reset);
    assert.equal(f.verifications(), 0);
  }
});

function navigationFixture() {
  const memory = new Map();
  const store = new core.NavigationStore({
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  });
  let navigations = 0,
    verifications = 0;
  const registry = new core.CapabilityRegistry(
    { schemaVersion: '0.1', capabilities: [core.navigationCapability] },
    {
      handlers: { 'browser.navigate': (p, context) => context.navigate(p.url) },
      verifiers: {
        'browser.verifyNavigation': () => {
          verifications++;
          return { verified: true };
        },
      },
      parameters: {
        'browser.navigate': {
          schema: core.navigationCapability.inputSchema,
          validate: (p) => typeof p.url === 'string',
        },
      },
    },
  );
  const observer = {
    document: { URL: snapshot.url, defaultView: {} },
    observe: () => ({ ...snapshot, url: observer.document.URL }),
    requireSnapshot: () => snapshot,
    allowedUrl: (value) => new URL(value, snapshot.url),
  };
  const runtime = new core.BrowserRuntime({
    observer,
    registry,
    navigationStore: store,
    navigation: {
      mode: 'document',
      navigate: () => {
        navigations++;
      },
    },
  });
  return { runtime, observer, counts: () => ({ navigations, verifications }) };
}

test('document navigation stays pending and destination progress verifies without re-execution', async () => {
  const f = navigationFixture(),
    initial = [],
    resumed = [];
  const destination = 'https://example.test/next';
  const navigation = {
    ...call,
    capabilityId: 'browser.navigate',
    parameters: { url: destination },
  };
  assert.equal(
    (
      await f.runtime.execute(navigation, {
        onActionProgress: (e) => initial.push(e),
      })
    ).code,
    'NAVIGATION_PENDING',
  );
  assert.deepEqual(stages(initial), [
    'checking',
    'executing',
    'navigation_pending',
  ]);
  assert.deepEqual(f.counts(), { navigations: 1, verifications: 0 });
  f.observer.document.URL = destination;
  assert.equal(
    (
      await f.runtime.resumeNavigation({
        onActionProgress: (e) => resumed.push(e),
      })
    ).status,
    'success',
  );
  assert.deepEqual(stages(resumed), ['checking', 'verifying', 'verified']);
  assert.deepEqual(f.counts(), { navigations: 1, verifications: 1 });
  assert.equal(await f.runtime.resumeNavigation(), undefined);
});

test('cancellation from a resumed checking observer prevents its verifier', async () => {
  const f = navigationFixture(),
    destination = 'https://example.test/next',
    events = [];
  await f.runtime.execute({
    ...call,
    capabilityId: 'browser.navigate',
    parameters: { url: destination },
  });
  f.observer.document.URL = destination;
  const result = await f.runtime.resumeNavigation({
    onActionProgress: (event) => {
      events.push(event);
      if (event.stage === 'checking') f.runtime.cancel();
    },
  });
  assert.equal(result.code, 'CANCELLED');
  assert.deepEqual(stages(events), ['checking', 'cancelled']);
  assert.deepEqual(f.counts(), { navigations: 1, verifications: 0 });
});

test('stage/code catalogs are immutable and cancellation at verifier entry prevents invocation', async () => {
  assert.equal(Object.isFrozen(core.ACTION_PROGRESS_STAGES), true);
  assert.equal(Object.isFrozen(core.ACTION_PROGRESS_CODES), true);
  assert.throws(() => core.ACTION_PROGRESS_CODES.push('PRIVATE_CODE'));
  const f = fixture(),
    events = [];
  const result = await f.runtime.execute(call, {
    onActionProgress: (event) => {
      events.push(event);
      if (event.stage === 'verifying') f.runtime.cancel();
    },
  });
  assert.equal(result.code, 'CANCELLED');
  assert.deepEqual(stages(events), [
    'checking',
    'executing',
    'verifying',
    'cancelled',
  ]);
  assert.equal(f.verifications(), 0);
});

test('client ignores mismatched/regressing/late progress and projects no arbitrary fields or codes', async () => {
  let late;
  const runtime = {
    registry: { list: () => [definition] },
    observe: () => structuredClone(snapshot),
    resetSession() {},
    execute: async (input, options) => {
      late = options.onActionProgress;
      const base = { callId: input.callId, capabilityId: input.capabilityId };
      late({ ...base, stage: 'checking' });
      late({ ...base, stage: 'thinking', private: 'private-field-marker' });
      late({ ...base, callId: 'wrong-call', stage: 'executing' });
      late({
        ...base,
        stage: 'failed',
        code: 'PRIVATE_CODE_MARKER',
        message: 'private-error-marker',
      });
      late({ ...base, stage: 'verified', code: 'VERIFIED' });
      return {
        ...base,
        protocolVersion: '0.1',
        status: 'failed',
        code: 'HANDLER_FAILED',
        message: 'Fixed failure.',
        evidence: {},
        observation: snapshot,
      };
    },
  };
  const client = assistant(runtime, async (request) =>
    reply(request, Boolean(request.result)),
  );
  await client.send('Set panel');
  const entry = client.state.actionProgress.at(-1);
  assert.deepEqual(entry.stages, ['checking', 'failed']);
  assert.equal(entry.code, 'ACTION_FAILED');
  assert.doesNotMatch(JSON.stringify(entry), /private-|PRIVATE_CODE|message/);
  client.reset();
  late({
    callId: entry.callId,
    capabilityId: entry.capabilityId,
    stage: 'verified',
  });
  assert.deepEqual(client.state.actionProgress, []);
});

test('a host error using a reserved code cannot invent successful navigation or verification', async () => {
  for (const code of ['NAVIGATION_PENDING', 'VERIFIED']) {
    const f = fixture({
      execute: () => {
        throw new core.PageSquireError(code, 'private-host-marker');
      },
    });
    let requests = 0;
    const client = assistant(f.runtime, async (request) => {
      requests++;
      return reply(request, Boolean(request.result));
    });
    await client.send('Set panel');
    assert.equal(client.state.actionProgress.at(-1).stage, 'failed');
    assert.equal(requests, 2);
    assert.doesNotMatch(
      JSON.stringify(client.state.actionProgress),
      /private-host-marker/,
    );
    assert.doesNotMatch(
      client.state.messages.at(-1).text,
      /Navigation started/,
    );
  }
});

test('a failed action ends the turn unless the client opts into server-led recovery', async () => {
  for (const allowRecovery of [false, true]) {
    let verifications = 0;
    const f = fixture({
      verify: () => ({ verified: ++verifications > 1 }),
    });
    const requests = [];
    const client = assistant(
      f.runtime,
      async (request) => {
        requests.push(request);
        // The server proposes another action after the failed one, then finishes.
        return reply(request, requests.length === 3);
      },
      allowRecovery ? { allowRecovery } : {},
    );
    await client.send('Set panel');
    const results = requests.filter((request) => request.result);
    if (allowRecovery) {
      assert.deepEqual(
        results.map((request) => request.result.status),
        ['unverified', 'success'],
      );
      assert.equal(client.state.messages.at(-1).text, 'Done');
    } else {
      assert.equal(results.length, 1);
      assert.equal(f.executions(), 1);
      assert.match(client.state.messages.at(-1).text, /could not verify/i);
    }
  }
});
