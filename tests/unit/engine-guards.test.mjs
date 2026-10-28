import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGenericCapabilities } from '../../packages/core/dist/index.js';
import {
  ConversationEngine,
  MemoryTrajectoryCache,
  trajectoryKey,
} from '@pagesquire/server';

const manifest = {
  schemaVersion: '0.1',
  capabilities: createGenericCapabilities(),
};
const ids = manifest.capabilities.map((entry) => entry.id);
const snapshot = (targets, id = 'snapshot-1') => ({
  protocolVersion: '0.1',
  id,
  url: 'https://example.test/profile',
  title: 'Profile',
  text: 'Profile form',
  targets: targets.map(([target, name]) => ({
    id: target,
    tag: 'input',
    name,
    role: 'textbox',
    disabled: false,
    actionable: true,
  })),
  truncated: { text: false, targets: false },
});
const request = (message, page, requestId = 'r1') => ({
  protocolVersion: '0.1',
  requestId,
  message,
  snapshot: page,
  capabilityIds: ids,
});
const result = (state, page, requestId) => ({
  protocolVersion: '0.1',
  requestId,
  conversationId: state.id,
  snapshot: page,
  capabilityIds: ids,
  result: {
    protocolVersion: '0.1',
    callId: state.pending.callId,
    capabilityId: state.pending.capabilityId,
    status: 'success',
    code: 'VERIFIED',
    message: 'Verified.',
    evidence: {},
  },
});
const type = (target, text) => ({
  text: 'Typing',
  emotion: 'thinking',
  finished: false,
  toolCalls: [
    { capabilityId: 'ui.type', parameters: { target, text, clear: true } },
  ],
});
const done = { text: 'Done.', emotion: 'happy', finished: true, toolCalls: [] };
function scripted(replies) {
  const provider = {
    calls: 0,
    async complete() {
      provider.calls++;
      return structuredClone(replies.shift());
    },
  };
  return provider;
}

test('generic typing of contact data the visitor never gave is refused', async () => {
  const provider = scripted([type('target-1', 'evil@attacker.test')]);
  const engine = new ConversationEngine({ manifest, provider });
  const { reply } = await engine.handle(
    request('Fill in the form', snapshot([['target-1', 'Email']])),
    null,
    ids,
  );
  assert.equal(reply.response.finished, true);
  assert.equal(reply.response.emotion, 'confused');
  assert.match(reply.response.text, /won't type/);
  const allowed = new ConversationEngine({
    manifest,
    provider: scripted([type('target-1', 'ana@example.com')]),
  });
  const ok = await allowed.handle(
    request(
      'Set my email to ana@example.com',
      snapshot([['target-1', 'Email']]),
    ),
    null,
    ids,
  );
  assert.equal(ok.reply.response.finished, false);
});

test('a cached trajectory is replayed by target name on a fresh page without the provider', async () => {
  const cache = new MemoryTrajectoryCache();
  const provider = scripted([type('target-1', 'Ana'), done]);
  const engine = new ConversationEngine({
    manifest,
    provider,
    trajectoryCache: cache,
  });
  const first = snapshot([['target-1', 'Your name']]);
  let outcome = await engine.handle(
    request('Set my name to Ana', first),
    null,
    ids,
  );
  outcome = await engine.handle(
    result(outcome.state, first, 'r2'),
    outcome.state,
    ids,
  );
  assert.equal(outcome.reply.response.finished, true);
  assert.equal(provider.calls, 2);
  const later = snapshot(
    [
      ['target-9', 'Your name'],
      ['target-10', 'Other'],
    ],
    'snapshot-2',
  );
  const replay = await engine.handle(
    request('  set my NAME to ana ', later, 'r3'),
    null,
    ids,
  );
  assert.deepEqual(replay.reply.response.toolCalls[0].parameters, {
    target: 'target-9',
    text: 'Ana',
    clear: true,
  });
  const finished = await engine.handle(
    result(replay.state, later, 'r4'),
    replay.state,
    ids,
  );
  assert.equal(finished.reply.response.text, 'Done.');
  assert.equal(provider.calls, 2, 'The replay made no provider calls');
});

test('page-derived text and ambiguous targets are never cached', async () => {
  const cache = new MemoryTrajectoryCache();
  for (const [reply, page] of [
    [type('target-1', 'Bob'), snapshot([['target-1', 'Your name']])],
    [
      type('target-1', 'Ana'),
      snapshot([
        ['target-1', 'Name'],
        ['target-2', 'Name'],
      ]),
    ],
  ]) {
    const engine = new ConversationEngine({
      manifest,
      provider: scripted([reply, done]),
      trajectoryCache: cache,
    });
    const message = 'Fill my name with Ana';
    let outcome = await engine.handle(request(message, page), null, ids);
    await engine.handle(result(outcome.state, page, 'r2'), outcome.state, ids);
    assert.equal(cache.get(trajectoryKey(message, page.url, ids)), undefined);
  }
});
