import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssistantClient, ChatNavigationStore } from '@pagesquire/client';

const snapshot = {
  protocolVersion: '0.1',
  id: 'destination-snapshot',
  url: 'https://example.test/next',
  title: 'Destination',
  text: 'Ready',
  targets: [],
  truncated: { text: false, targets: false },
};
const result = {
  protocolVersion: '0.1',
  callId: 'navigation-call',
  capabilityId: 'browser.navigate',
  status: 'success',
  code: 'VERIFIED',
  message: 'Destination verified',
  evidence: {},
  observation: snapshot,
};
function create(options = {}) {
  const values = new Map();
  const store = new ChatNavigationStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
  store.save({
    conversationId: 'conversation',
    callId: 'navigation-call',
    expectedUrl: snapshot.url,
    origin: 'https://example.test',
    issuedAt: Date.now(),
    remainingRounds: 3,
    ...options.checkpoint,
  });
  let executions = 0;
  let resumptions = 0;
  let cancellations = 0;
  const requests = [];
  const runtime = {
    observer: { document: { URL: snapshot.url } },
    registry: { list: () => [] },
    observe: () => snapshot,
    resumeNavigation: async () => {
      resumptions++;
      return options.resume
        ? options.resume()
        : { ...result, ...options.result };
    },
    cancel: () => {
      cancellations++;
    },
    execute: async () => {
      executions++;
      throw Error('Navigation must not be executed again.');
    },
  };
  const client = new AssistantClient({
    runtime,
    navigationStore: store,
    transport: async (request) => {
      requests.push(request);
      return {
        protocolVersion: '0.1',
        conversationId: 'conversation',
        response: {
          protocolVersion: '0.1',
          text: 'The action was verified.',
          emotion: 'happy',
          finished: true,
          toolCalls: [],
        },
      };
    },
  });
  return {
    client,
    requests,
    counts: () => ({ executions, resumptions, cancellations }),
    values,
  };
}
test('client resumes an existing conversation once with verified telemetry and no replayed navigation', async () => {
  const { client, requests, counts, values } = create();
  await client.resumeNavigation();
  await client.resumeNavigation();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].conversationId, 'conversation');
  assert.equal(requests[0].result.callId, result.callId);
  assert.equal(requests[0].snapshot.id, snapshot.id);
  assert.equal(Object.hasOwn(requests[0], 'message'), false);
  assert.deepEqual(counts(), {
    executions: 0,
    resumptions: 1,
    cancellations: 0,
  });
  assert.equal(values.size, 0);
  assert.equal(client.state.busy, false);
  assert.equal(client.state.emotion, 'happy');
  assert.ok(!client.state.messages.some((message) => message.role === 'user'));
});
test('client fails closed on wrong/expired checkpoints and cannot turn unverified resumption into success', async () => {
  for (const options of [
    { result: { callId: 'wrong' } },
    { result: { capabilityId: 'other.action' } },
  ]) {
    const fixture = create(options);
    await fixture.client.resumeNavigation();
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.counts().executions, 0);
    assert.equal(fixture.client.state.emotion, 'confused');
    assert.equal(fixture.client.state.busy, false);
  }
  const expired = create({ checkpoint: { issuedAt: Date.now() - 61000 } });
  await expired.client.resumeNavigation();
  assert.equal(expired.counts().resumptions, 0);
  assert.equal(expired.requests.length, 0);
  const unverified = create({ result: { status: 'unverified' } });
  await unverified.client.resumeNavigation();
  assert.equal(unverified.requests.length, 1);
  assert.equal(unverified.client.state.emotion, 'confused');
  assert.equal(
    unverified.client.state.messages.at(-1).text,
    'I could not verify that the action completed.',
  );
});
test('client cancellation settles even a resumed verifier that never resolves and rejects concurrent sends', async () => {
  const { client, counts, requests } = create({
    resume: () => new Promise(() => {}),
  });
  const waiting = client.resumeNavigation();
  await assert.rejects(client.send('Another message'), { code: 'BUSY' });
  client.cancel();
  await waiting;
  assert.equal(counts().cancellations, 1);
  assert.equal(requests.length, 0);
  assert.equal(client.state.busy, false);
  assert.equal(client.state.emotion, 'idle');
});
