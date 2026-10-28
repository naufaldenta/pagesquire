import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '../../packages/core/dist/index.js';

const schema = (properties = {}) => ({
  type: 'object',
  properties,
  ...(Object.keys(properties).length
    ? { required: Object.keys(properties) }
    : {}),
  additionalProperties: false,
});
const definitions = [
  {
    id: 'page.read_summary',
    description: 'Read the public summary.',
    risk: 'read_only',
    inputSchema: schema(),
  },
  {
    id: 'theme.set_contrast',
    description: 'Turn high contrast on or off.',
    risk: 'reversible',
    inputSchema: schema({ enabled: { type: 'boolean' } }),
  },
  {
    id: 'account.delete',
    description: 'Delete the account.',
    risk: 'consequential',
    inputSchema: schema(),
  },
].map((entry) => ({
  ...entry,
  execution: 'browser',
  handler: entry.id,
  verification: { handler: `${entry.id}.verify` },
}));

function fixture() {
  const state = { contrast: false, deleted: false };
  const handlers = {
    'page.read_summary': () => {},
    'theme.set_contrast': (args) => {
      state.contrast = args.enabled;
    },
    'account.delete': () => {
      state.deleted = true;
    },
  };
  const verifiers = {
    'page.read_summary.verify': () => ({
      verified: true,
      evidence: { summary: 'Public summary' },
    }),
    'theme.set_contrast.verify': (args) => ({
      verified: state.contrast === args.enabled,
      evidence: { enabled: state.contrast },
    }),
    'account.delete.verify': () => ({ verified: true }),
  };
  const parameters = Object.fromEntries(
    definitions.map((definition) => [
      definition.id,
      {
        schema: definition.inputSchema,
        validate: (input) =>
          definition.id === 'theme.set_contrast'
            ? Object.keys(input).join() === 'enabled' &&
              typeof input.enabled === 'boolean'
            : Object.keys(input).length === 0,
      },
    ]),
  );
  const registry = new core.CapabilityRegistry(
    { schemaVersion: '0.1', capabilities: definitions },
    { handlers, verifiers, parameters },
  );
  let count = 0;
  let current;
  const snapshot = () => ({
    protocolVersion: '0.1',
    id: `snapshot-${++count}`,
    url: 'https://example.test/',
    title: 'Example',
    text: 'private-page-text-marker',
    targets: [],
    truncated: { text: false, targets: false },
  });
  const observer = {
    document: {
      URL: 'https://example.test/',
      defaultView: { crypto: globalThis.crypto },
    },
    observe: () => (current = snapshot()),
    requireSnapshot: (id) => {
      if (current?.id !== id)
        throw new core.PageSquireError('STALE_SNAPSHOT', 'Observe again.');
      return current;
    },
  };
  const runtime = new core.BrowserRuntime({ observer, registry });
  const tools = new Map();
  const signals = [];
  const modelContext = {
    registerTool(tool, options) {
      if (tools.has(tool.name)) throw new Error('Duplicate tool');
      tools.set(tool.name, tool);
      signals.push(options.signal);
    },
  };
  return { runtime, tools, signals, modelContext, state };
}

test('WebMCP exposes non-consequential capabilities with matching annotations', async () => {
  const f = fixture();
  const registration = await core.exposeToWebMcp(f.runtime, {
    modelContext: f.modelContext,
  });
  assert.deepEqual(registration.registered, [
    'page.read_summary',
    'theme.set_contrast',
  ]);
  assert.deepEqual(registration.rejected, []);
  assert.equal(f.tools.has('account.delete'), false);
  const read = f.tools.get('page.read_summary');
  assert.deepEqual(read.annotations, {
    readOnlyHint: true,
    untrustedContentHint: true,
    consequentialHint: false,
  });
  assert.equal(
    f.tools.get('theme.set_contrast').annotations.readOnlyHint,
    false,
  );
  assert.deepEqual(
    f.tools.get('theme.set_contrast').inputSchema,
    definitions[1].inputSchema,
  );
});

test('WebMCP tool calls run the verified runtime path and never return page text', async () => {
  const f = fixture();
  await core.exposeToWebMcp(f.runtime, { modelContext: f.modelContext });
  const contrast = f.tools.get('theme.set_contrast');
  const result = await contrast.execute({ enabled: true });
  assert.deepEqual(result, {
    status: 'success',
    code: 'VERIFIED',
    message: 'The requested state was verified.',
    evidence: { enabled: true },
  });
  assert.equal(f.state.contrast, true);
  const invalid = await contrast.execute({ enabled: 'yes' });
  assert.equal(invalid.status, 'failed');
  assert.equal(invalid.code, 'INVALID_PARAMETERS');
  const cancelled = new AbortController();
  cancelled.abort();
  assert.equal(
    (await contrast.execute({ enabled: false }, { signal: cancelled.signal }))
      .status,
    'cancelled',
  );
  assert.equal(f.state.contrast, true);
  assert.doesNotMatch(
    JSON.stringify(await f.tools.get('page.read_summary').execute({})),
    /private-page-text-marker|observation/,
  );
});

test('WebMCP is a no-op without modelContext and unregisters on dispose or abort', async () => {
  const f = fixture();
  const absent = await core.exposeToWebMcp(f.runtime);
  assert.deepEqual(absent.registered, []);
  const filtered = await core.exposeToWebMcp(f.runtime, {
    modelContext: f.modelContext,
    include: (definition) => definition.risk === 'read_only',
  });
  assert.deepEqual(filtered.registered, ['page.read_summary']);
  const duplicate = await core.exposeToWebMcp(f.runtime, {
    modelContext: f.modelContext,
  });
  assert.deepEqual(duplicate.rejected, ['page.read_summary']);
  assert.deepEqual(duplicate.registered, ['theme.set_contrast']);
  filtered.dispose();
  assert.equal(f.signals[0].aborted, true);
  const host = new AbortController();
  await core.exposeToWebMcp(fixture().runtime, {
    modelContext: f.modelContext,
    signal: host.signal,
    include: () => false,
  });
  host.abort();
  const aborted = await core.exposeToWebMcp(f.runtime, {
    modelContext: f.modelContext,
    signal: host.signal,
  });
  assert.deepEqual(aborted.registered, []);
});
