import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TraceRecorder } from '../../packages/client/dist/index.js';
import { oracleProvider, parseArguments } from '../../scripts/eval-generic.mjs';
import { tasks } from '../eval/generic-tasks.mjs';

const events = [
  { type: 'message', at: 1, text: 'private message marker' },
  {
    type: 'request',
    at: 2,
    requestId: 'r1',
    snapshot: {
      id: 's1',
      url: 'https://example.test/page?token-like=private',
      targets: 3,
      newTargets: 1,
      removedTargets: 0,
      truncated: false,
    },
    capabilities: 4,
  },
  {
    type: 'reply',
    at: 3,
    requestId: 'r1',
    durationMs: 1,
    finished: false,
    emotion: 'thinking',
    text: 'private model marker',
    action: {
      callId: 'c1',
      capabilityId: 'ui.type',
      parameters: { target: 'target-1', text: 'private typed marker' },
    },
  },
  {
    type: 'result',
    at: 4,
    callId: 'c1',
    capabilityId: 'ui.type',
    status: 'success',
    code: 'VERIFIED',
    durationMs: 2,
    evidence: { length: 20 },
  },
  { type: 'error', at: 5, code: 'TIMEOUT', message: 'Timed out.' },
];

test('trace recorder redacts content by default, keeps structure and stays bounded', () => {
  const recorder = new TraceRecorder({ limit: 4 });
  let notified = 0;
  recorder.subscribe(() => notified++);
  for (const event of events) recorder.record(event);
  const exported = recorder.toJSON();
  assert.equal(exported.events.length, 4);
  assert.equal(notified, 5);
  assert.doesNotMatch(
    JSON.stringify(exported),
    /private|token-like/,
    'Message text, model text, parameter values and URL queries are redacted',
  );
  const reply = exported.events.find((event) => event.type === 'reply');
  assert.deepEqual(Object.keys(reply.action.parameters), ['target', 'text']);
  assert.deepEqual(exported.summary, {
    requests: 1,
    actions: 1,
    verified: 1,
    failed: 0,
    errors: 1,
  });
  const full = new TraceRecorder({ includeContent: true });
  for (const event of events) full.record(event);
  assert.match(JSON.stringify(full.toJSON()), /private typed marker/);
  full.clear();
  assert.equal(full.entries.length, 0);
  assert.throws(() => new TraceRecorder({ limit: 0 }), RangeError);
});

test('eval harness arguments require an explicit live budget and known tasks', () => {
  assert.deepEqual(parseArguments([]), {
    live: false,
    maxCalls: 0,
    tasks: [],
    headed: false,
    validate: false,
    cache: false,
    repeat: 1,
  });
  assert.deepEqual(
    parseArguments(['--validate', '--cache', '--repeat', '2']).repeat,
    2,
  );
  assert.throws(() => parseArguments(['--repeat', '9']), /--repeat/);
  assert.throws(() => parseArguments(['--live']), /--max-calls/);
  assert.throws(() => parseArguments(['--max-calls', '0']), /--max-calls/);
  assert.throws(() => parseArguments(['--tasks', 'nope']), /Unknown tasks/);
  assert.deepEqual(
    parseArguments(['--live', '--max-calls', '20', '--tasks', 'type-name'])
      .tasks,
    ['type-name'],
  );
});

test('task set is broad, unique and every task has an oracle and checks', () => {
  assert.ok(tasks.length >= 30);
  assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length);
  for (const task of tasks) {
    assert.ok(task.instruction && task.oracle.length && task.checks.length);
    assert.match(task.page, /^\/[a-z-]+\.html$/);
  }
  const categories = new Set(tasks.map((task) => task.category));
  for (const category of ['safety', 'recovery', 'approval', 'find'])
    assert.ok(categories.has(category), category);
});

test('oracle provider resolves target names from the latest snapshot and finishes', async () => {
  const provider = oracleProvider({
    oracle: [
      { tool: 'ui.click', params: { target: '@Save' } },
      { say: 'Saved.' },
    ],
  });
  const page = (targets) => JSON.stringify({ untrustedPage: { targets } });
  const first = await provider.complete([
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'Save it' },
    { role: 'user', content: page([{ id: 'target-7', name: 'Save' }]) },
  ]);
  assert.deepEqual(first.toolCalls, [
    { capabilityId: 'ui.click', parameters: { target: 'target-7' } },
  ]);
  const second = await provider.complete([
    { role: 'user', content: 'Save it' },
    { role: 'user', content: JSON.stringify({ browserResult: {} }) },
    { role: 'user', content: page([]) },
  ]);
  assert.equal(second.finished, true);
  assert.equal(second.text, 'Saved.');
  assert.equal(provider.calls, 2);
});
