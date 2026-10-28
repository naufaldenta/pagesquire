import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateChatReply } from '@pagesquire/protocol';
import { planSteps } from '@pagesquire/server';
import { AssistantClient } from '../../packages/client/dist/index.js';

const snapshot = {
  protocolVersion: '0.1',
  id: 'snapshot',
  url: 'https://example.test/',
  title: '',
  text: '',
  targets: [],
  truncated: { text: false, targets: false },
};
const reply = (response) => ({
  protocolVersion: '0.1',
  conversationId: 'conversation',
  response: { protocolVersion: '0.1', emotion: 'thinking', ...response },
});
const call = {
  protocolVersion: '0.1',
  callId: 'call-1',
  capabilityId: 'testing.set',
  snapshotId: 'snapshot',
  parameters: {},
};

test('planner answers normalize to two to five short steps or none', () => {
  assert.deepEqual(planSteps('1. Open settings\n2) Turn on dark mode\n'), [
    'Open settings',
    'Turn on dark mode',
  ]);
  assert.deepEqual(planSteps('- a\n* b\n• c'), ['a', 'b', 'c']);
  assert.deepEqual(planSteps('Just one step'), []);
  assert.deepEqual(planSteps(''), []);
  assert.deepEqual(planSteps('1\n2\n3\n4\n5\n6'), []);
});

test('the reply schema bounds the optional plan', () => {
  const action = { text: 'x', finished: false, toolCalls: [call] };
  assert.equal(
    validateChatReply(reply({ ...action, plan: ['a', 'b'] })).valid,
    true,
  );
  for (const plan of [['only one'], ['a', 'b', 'c', 'd', 'e', 'f'], ['a', '']])
    assert.equal(validateChatReply(reply({ ...action, plan })).valid, false);
});

test('the client shows a plan once, as its own message, before the action runs', async () => {
  const order = [];
  const replies = [
    reply({
      text: 'Checking the requested action…',
      finished: false,
      toolCalls: [call],
      plan: ['Set the value', 'Confirm the result'],
    }),
    reply({ text: 'Done.', emotion: 'happy', finished: true, toolCalls: [] }),
  ];
  const client = new AssistantClient({
    locale: 'id',
    runtime: {
      observe: () => structuredClone(snapshot),
      registry: { list: () => [] },
      resetSession() {},
      async execute(action) {
        order.push(`execute:${client.state.messages.length}`);
        return {
          protocolVersion: '0.1',
          callId: action.callId,
          capabilityId: action.capabilityId,
          status: 'success',
          code: 'VERIFIED',
          message: '',
          evidence: {},
        };
      },
    },
    transport: async () => replies.shift(),
  });
  await client.send('Set it and confirm');
  const texts = client.state.messages.map((message) => message.text);
  assert.deepEqual(texts, [
    'Set it and confirm',
    'Rencana:\n1. Set the value\n2. Confirm the result',
    'testing.set: success',
    'Done.',
  ]);
  assert.deepEqual(order, ['execute:2']);
});
