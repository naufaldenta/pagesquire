import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '../../packages/core/dist/index.js';
import { manifest } from '../fixtures/capabilities.mjs';
import { parameters } from '../fixtures/dist/bindings.js';

function fixture(options = {}) {
  let invoked = 0;
  const registry = new core.CapabilityRegistry(manifest, {
    handlers: Object.fromEntries(
      manifest.capabilities.map((c) => [c.handler, () => invoked++]),
    ),
    verifiers: Object.fromEntries(
      manifest.capabilities.map((c) => [
        c.verification.handler,
        () => {
          invoked++;
          return { verified: true };
        },
      ]),
    ),
    parameters,
  });
  const document = { URL: 'https://example.test/?private=do-not-export' };
  const observer = {
    document,
    allowedUrl() {},
    isExcluded: (target) => target.private === true,
    isVisible: (target) => target.visible !== false,
    canInteract: (target) => target.permitted === true,
    observe() {
      throw Error('Inspector must not replace the action snapshot');
    },
  };
  const inspector = new core.CapabilityInspector({
    registry,
    observer,
    ...options,
  });
  const target = (extra = {}) => ({
    ownerDocument: document,
    isConnected: true,
    matches: () => false,
    getAttribute: () => null,
    ...extra,
  });
  return { inspector, registry, observer, target, invoked: () => invoked };
}

const id = manifest.capabilities[0].id;

test('inspection is opt-in, metadata-only by default and does not execute any binding', () => {
  const { inspector, invoked } = fixture();
  const first = inspector.inspect();
  assert.equal(first.entries.length, manifest.capabilities.length);
  assert.equal(first.authorization, 'not_evaluated');
  assert.equal(first.entries[0].status, 'not_checked');
  assert.equal(first.entries[0].bindings, 'validated');
  assert.equal(
    first.counts.unchecked,
    manifest.capabilities.filter((c) => c.risk !== 'consequential').length,
  );
  assert.equal(
    first.counts.blocked,
    manifest.capabilities.filter((c) => c.risk === 'consequential').length,
  );
  assert.equal(invoked(), 0);
  assert.throws(() => {
    first.entries[0].status = 'ready';
  }, TypeError);
  assert.throws(() => {
    first.entries[0].definition.description = 'changed';
  }, TypeError);
});

test('expected coverage distinguishes unregistered features without weakening registry validation', () => {
  const { inspector } = fixture({ expected: [id, 'app.not_installed'] });
  const report = inspector.inspect();
  assert.equal(report.counts.expected, 2);
  assert.equal(report.counts.missing, 1);
  assert.deepEqual(report.entries.at(-1), {
    id: 'app.not_installed',
    expected: true,
    definition: null,
    bindings: 'absent',
    status: 'not_registered',
  });
  assert.throws(() => fixture({ expected: ['#selector'] }), {
    code: 'INVALID_OPTIONS',
  });
  assert.throws(() => fixture({ expected: [id, id] }), {
    code: 'INVALID_OPTIONS',
  });
  assert.throws(() => fixture({ expected: Array(1001).fill(id) }), {
    code: 'INVALID_OPTIONS',
  });
  assert.throws(
    () => fixture({ probes: { 'app.unknown': { resolve: () => null } } }),
    { code: 'INVALID_OPTIONS' },
  );
});

test('host probes report actual target problems and preparation without running preparations', () => {
  const { registry, observer, target } = fixture();
  for (const [value, probe, status] of [
    [null, {}, 'target_missing'],
    [[], {}, 'target_missing'],
    [[target(), target()], {}, 'target_ambiguous'],
    [target({ private: true }), {}, 'target_private'],
    [
      target({ private: true, visible: false }),
      { requiresPreparation: true },
      'target_private',
    ],
    [target({ isConnected: false }), {}, 'target_missing'],
    [target({ ownerDocument: {} }), {}, 'target_missing'],
    [target({ visible: false }), {}, 'target_hidden'],
    [
      target({ visible: false }),
      { requiresPreparation: true },
      'needs_preparation',
    ],
    [target({ matches: () => true }), {}, 'target_disabled'],
    [target({ getAttribute: () => 'true' }), {}, 'target_disabled'],
    [target(), { interaction: 'click' }, 'interaction_denied'],
    [target({ permitted: true }), { interaction: 'fill' }, 'ready'],
    [[target()], {}, 'ready'],
    [{}, {}, 'probe_failed'],
  ]) {
    const inspector = new core.CapabilityInspector({
      registry,
      observer,
      probes: { [id]: { resolve: () => value, ...probe } },
    });
    assert.equal(inspector.inspect().entries[0].status, status);
  }
});

test('scope denial and consequential alpha blocks skip target resolution', () => {
  const { registry, observer } = fixture();
  let calls = 0;
  const probe = {
    resolve() {
      calls++;
      throw Error('private failure');
    },
  };
  const inspector = new core.CapabilityInspector({
    registry,
    observer,
    probes: { [id]: probe },
  });
  observer.allowedUrl = () => {
    throw Error('private URL detail');
  };
  assert.equal(inspector.inspect().entries[0].status, 'scope_denied');
  assert.equal(calls, 0);

  const consequential = structuredClone(manifest.capabilities[0]);
  consequential.risk = 'consequential';
  const blockedRegistry = new core.CapabilityRegistry(
    { schemaVersion: '0.1', capabilities: [consequential] },
    {
      handlers: { [consequential.handler]: () => calls++ },
      verifiers: {
        [consequential.verification.handler]: () => {
          calls++;
          return { verified: true };
        },
      },
      parameters,
    },
  );
  observer.allowedUrl = () => {};
  const blocked = new core.CapabilityInspector({
    registry: blockedRegistry,
    observer,
    probes: { [id]: probe },
  }).inspect();
  assert.equal(blocked.entries[0].status, 'blocked_in_alpha');
  assert.equal(blocked.counts.blocked, 1);
  assert.equal(calls, 0);
});

test('diagnostics whitelist metadata, sanitize failures and export the last check without probing again', () => {
  const { registry, observer } = fixture();
  let calls = 0;
  const inspector = new core.CapabilityInspector({
    registry,
    observer,
    probes: {
      [id]: {
        resolve() {
          calls++;
          throw Error('secret-token-and-selector');
        },
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(
    JSON.parse(inspector.exportDiagnostics()).entries[0].status,
    'not_checked',
  );
  inspector.inspect();
  const json = inspector.exportDiagnostics();
  assert.equal(calls, 1);
  assert.equal(JSON.parse(json).entries[0].status, 'probe_failed');
  assert.deepEqual(Object.keys(JSON.parse(json).entries[0]).sort(), [
    'bindings',
    'expected',
    'id',
    'risk',
    'status',
  ]);
  assert.doesNotMatch(
    json,
    /secret-token|do-not-export|inputSchema|description|aliases|snapshot|handler|selector|https:/,
  );
  assert.equal(json, inspector.exportDiagnostics());
  assert.equal(calls, 1);
});

test('probe configuration is bounded, copied and rejects invalid or inherited probes', () => {
  const { registry, observer, target } = fixture();
  const probe = { resolve: () => target(), requiresPreparation: false };
  const inspector = new core.CapabilityInspector({
    registry,
    observer,
    probes: { [id]: probe },
  });
  probe.resolve = () => null;
  assert.equal(inspector.inspect().entries[0].status, 'ready');
  for (const invalid of [
    { resolve: null },
    { resolve() {}, interaction: 'delete' },
    { resolve() {}, requiresPreparation: 'yes' },
  ]) {
    assert.throws(
      () =>
        new core.CapabilityInspector({
          registry,
          observer,
          probes: { [id]: invalid },
        }),
      { code: 'INVALID_OPTIONS' },
    );
  }
  const inherited = new core.CapabilityInspector({
    registry,
    observer,
    probes: Object.create({ [id]: probe }),
  });
  assert.equal(inherited.inspect().entries[0].status, 'not_checked');
  let accessed = false;
  assert.throws(
    () =>
      new core.CapabilityInspector({
        registry,
        observer,
        probes: {
          get [id]() {
            accessed = true;
            return probe;
          },
        },
      }),
    { code: 'INVALID_OPTIONS' },
  );
  assert.equal(accessed, false);
});

test('sparse and accessor inventories fail without evaluating getters', () => {
  assert.throws(() => fixture({ expected: new Array(1) }), {
    code: 'INVALID_OPTIONS',
  });
  let accessed = false;
  const expected = [];
  Object.defineProperty(expected, '0', {
    get() {
      accessed = true;
      return id;
    },
  });
  assert.throws(() => fixture({ expected }), { code: 'INVALID_OPTIONS' });
  assert.equal(accessed, false);
});

test('incorrectly supplied asynchronous probes fail safely without unhandled rejections', async () => {
  const { registry, observer } = fixture();
  const inspector = new core.CapabilityInspector({
    registry,
    observer,
    probes: {
      [id]: {
        async resolve() {
          throw Error('private async detail');
        },
      },
    },
  });
  assert.equal(inspector.inspect().entries[0].status, 'probe_failed');
  await new Promise(setImmediate);
  assert.doesNotMatch(inspector.exportDiagnostics(), /private async detail/);
});
