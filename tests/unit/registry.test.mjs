import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CapabilityRegistry } from '@pagesquire/core';
import { manifest } from '../fixtures/capabilities.mjs';
import { parameters } from '../fixtures/dist/bindings.js';

const handlers = Object.fromEntries(
  manifest.capabilities.map((cap) => [cap.handler, () => {}]),
);
const verifiers = Object.fromEntries(
  manifest.capabilities.map((cap) => [
    cap.verification.handler,
    () => ({ verified: true }),
  ]),
);
const bindings = { handlers, verifiers, parameters };

test('a registry exposes immutable metadata and resolves parameters from the same schema', () => {
  const registry = new CapabilityRegistry(manifest, bindings);
  assert.equal(registry.list().length, manifest.capabilities.length);
  assert.equal(
    registry.resolve('accessibility.set_heading_color', { color: '#ff0000' })
      .definition.id,
    'accessibility.set_heading_color',
  );
  assert.throws(() => {
    registry.list()[0].description = 'changed';
  }, TypeError);
  assert.notEqual(registry.list()[0], manifest.capabilities[0]);
});

test('duplicates cannot silently override a registered capability', () => {
  assert.throws(
    () =>
      new CapabilityRegistry(
        {
          ...manifest,
          capabilities: [manifest.capabilities[0], manifest.capabilities[0]],
        },
        bindings,
      ),
    { code: 'DUPLICATE_CAPABILITY' },
  );
});

test('missing handlers, verifiers, or compiled validators fail during registration', () => {
  for (const overrides of [
    { handlers: {} },
    { verifiers: {} },
    { parameters: {} },
  ]) {
    assert.throws(
      () => new CapabilityRegistry(manifest, { ...bindings, ...overrides }),
      { code: 'MISSING_BINDING' },
    );
  }
});

test('changing a schema requires recompiling its parameter validator', () => {
  const copy = structuredClone(manifest);
  copy.capabilities[0].inputSchema.properties.color.pattern = '^[a-z]+$';
  assert.throws(() => new CapabilityRegistry(copy, bindings), {
    code: 'SCHEMA_MISMATCH',
  });
});

test('invalid parameters are rejected without coercion or dropping extra fields', () => {
  const registry = new CapabilityRegistry(manifest, bindings);
  for (const input of [
    { color: 'red' },
    { color: '#ff0000', selector: 'body' },
    {},
  ]) {
    assert.throws(
      () => registry.resolve('accessibility.set_heading_color', input),
      { code: 'INVALID_PARAMETERS' },
    );
  }
  assert.throws(
    () => registry.resolve('accessibility.set_font_weight', { weight: '700' }),
    { code: 'INVALID_PARAMETERS' },
  );
  assert.throws(() => registry.resolve('not.registered', {}), {
    code: 'UNKNOWN_CAPABILITY',
  });
});

test('manifest getters are rejected without executing them', () => {
  let evaluated = false;
  const input = {
    schemaVersion: '0.1',
    get capabilities() {
      evaluated = true;
      return [];
    },
  };
  assert.throws(() => new CapabilityRegistry(input, bindings), {
    code: 'INVALID_JSON',
  });
  assert.equal(evaluated, false);
});

test('inherited bindings never authorize a capability', () => {
  assert.throws(
    () =>
      new CapabilityRegistry(manifest, {
        ...bindings,
        handlers: Object.create(handlers),
      }),
    { code: 'MISSING_BINDING' },
  );
});

test('non-function bindings fail immediately instead of authorizing a broken adapter', () => {
  assert.throws(
    () =>
      new CapabilityRegistry(manifest, {
        ...bindings,
        handlers: { ...handlers, [manifest.capabilities[0].handler]: {} },
      }),
    { code: 'MISSING_BINDING' },
  );
});

test('oversized sparse arrays are rejected before materializing array entries', () => {
  const sparse = new Array(10_000_000);
  assert.throws(
    () =>
      new CapabilityRegistry(
        { schemaVersion: '0.1', capabilities: sparse },
        bindings,
      ),
    { code: 'INVALID_JSON' },
  );
});
