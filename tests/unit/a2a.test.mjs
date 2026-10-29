// PageSquire Link's optional A2A interface (Phase 6E): the signed Agent Card,
// the JSON-RPC endpoint, and the visitor's arrival from an agent's link.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createLinkCapabilities } from '../../packages/core/dist/index.js';
import {
  ConversationEngine,
  LinkManager,
  MemoryLinkStore,
  canonicalize,
  createA2AHandler,
  createSigningKey,
  siteJwk,
  verifyAgentCard,
} from '@pagesquire/server';

const vector = JSON.parse(
  await readFile(new URL('../fixtures/a2a.json', import.meta.url), 'utf8'),
);
const { signingKey } = JSON.parse(
  await readFile(new URL('../fixtures/signing.json', import.meta.url), 'utf8'),
);

function site(options = {}) {
  const store = options.store ?? new MemoryLinkStore();
  const manager = new LinkManager({
    store,
    signingKey: options.signingKey ?? signingKey,
    origin: vector.origin,
    profile: {
      endpoint: '/pagesquire/link',
      name: vector.name,
      skills: vector.skills,
    },
    ...(options.a2a === null ? {} : { a2a: options.a2a ?? vector.a2a }),
  });
  return { manager, store, handler: createA2AHandler(manager) };
}

let counter = 0;
async function rpc(
  handler,
  method,
  params,
  headers = { 'A2A-Version': '1.0' },
) {
  const response = await handler(
    new Request('https://resto.test/pagesquire/a2a', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++counter, method, params }),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}
const message = (parts, extra = {}) => ({
  message: { messageId: `m-${++counter}`, role: 'ROLE_USER', parts, ...extra },
});
const tableForFour = message([
  { text: 'Book a table for four.' },
  {
    data: {
      skill: 'book_table',
      goal: 'A table for 4 on 29 October',
      fields: { date: '2026-10-29', people: 4 },
    },
    mediaType: 'application/json',
  },
]);

test('canonical JSON and the Agent Card signature match the shared vector', () => {
  for (const { input, output } of vector.canonical)
    assert.equal(canonicalize(input), output);
  assert.deepEqual(siteJwk(signingKey), vector.jwk);
  const { manager } = site();
  assert.deepEqual(manager.agentCard(), vector.card);
  assert.deepEqual(manager.agentKeys(), { keys: [vector.jwk] });
});

test('the Agent Card lists the open skills and verifies with the published key set', () => {
  const { manager } = site({ a2a: { ...vector.a2a, skills: ['book_table'] } });
  const card = manager.agentCard();
  assert.deepEqual(card.supportedInterfaces, [
    {
      url: 'https://resto.test/pagesquire/a2a',
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    },
  ]);
  assert.deepEqual(
    card.skills.map((skill) => skill.id),
    ['book_table'],
  );
  assert.deepEqual(Object.keys(card.capabilities.extensions[0].params.skills), [
    'book_table',
  ]);
  const header = JSON.parse(
    Buffer.from(card.signatures[0].protected, 'base64url').toString(),
  );
  assert.deepEqual(header, {
    alg: 'EdDSA',
    jku: 'https://resto.test/.well-known/pagesquire-keys.json',
    kid: vector.jwk.kid,
    typ: 'JOSE',
  });
  const keys = manager.agentKeys();
  assert.equal(verifyAgentCard(card, keys), true);
  // Any change to the card, or another key, fails verification.
  assert.equal(
    verifyAgentCard({ ...card, name: 'Restoran Palsu' }, keys),
    false,
  );
  assert.equal(
    verifyAgentCard(card, {
      keys: [siteJwk(createSigningKey().signingKey)],
    }),
    false,
  );
  assert.equal(verifyAgentCard({ ...card, signatures: [] }, keys), false);
  // Without the A2A interface there is no card.
  assert.throws(() => site({ a2a: null }).manager.agentCard(), {
    code: 'A2A_DISABLED',
  });
  assert.throws(
    () => site({ a2a: { endpoint: '/a2a', skills: ['unknown'] } }),
    { code: 'INVALID_OPTIONS' },
  );
});

test('an agent sends a request and gets a single-use link for the person', async () => {
  const { manager, handler } = site();
  const answer = await rpc(handler, 'SendMessage', {
    ...tableForFour,
    message: { ...tableForFour.message, contextId: 'ctx-1' },
  });
  const reply = answer.result.message;
  assert.equal(answer.jsonrpc, '2.0');
  assert.equal(reply.role, 'ROLE_AGENT');
  assert.equal(reply.contextId, 'ctx-1');
  const { url, expiresAt } = reply.parts[1].data;
  assert.match(
    url,
    /^https:\/\/resto\.test\/reservations#psq-agent=[\w-]{22}$/,
  );
  assert.ok(reply.parts[0].text.includes(url));
  assert.ok(Date.parse(expiresAt) > Date.now() + 9 * 60_000);

  const ticket = await manager.redeem(url.split('#psq-agent=')[1]);
  assert.deepEqual(ticket, {
    kind: 'agent',
    link: 'a2a',
    skill: 'book_table',
    goal: 'A table for 4 on 29 October',
    fields: { date: '2026-10-29', people: 4 },
    expiresAt: Date.parse(expiresAt),
  });
  assert.equal(await manager.redeem(url.split('#psq-agent=')[1]), undefined);
  const { agents } = await manager.overview();
  assert.equal(agents.received, 1);
  assert.deepEqual(agents.skills, ['book_table', 'order_catering']);
  assert.equal(typeof agents.lastAt, 'number');
});

test('with one open skill, plain text is enough', async () => {
  const { manager, handler } = site({
    a2a: { ...vector.a2a, skills: ['order_catering'] },
  });
  const answer = await rpc(
    handler,
    'SendMessage',
    message([{ text: '  Catering for 40 people on Friday.  ' }]),
  );
  const { url } = answer.result.message.parts[1].data;
  assert.match(url, /^https:\/\/resto\.test\/catering#psq-agent=/);
  const ticket = await manager.redeem(url.split('#psq-agent=')[1]);
  assert.equal(ticket.goal, 'Catering for 40 people on Friday.');
  // With two open skills, the agent must name one.
  const refused = await rpc(
    site().handler,
    'SendMessage',
    message([{ text: 'Catering please.' }]),
  );
  assert.equal(refused.error.code, -32602);
});

test('the endpoint refuses what it does not serve with JSON-RPC errors', async () => {
  const { handler } = site();
  const code = async (...args) => (await rpc(handler, ...args)).error;
  // An empty A2A-Version means 0.3.
  assert.equal((await code('SendMessage', tableForFour, {})).code, -32009);
  assert.equal(
    (await code('SendMessage', tableForFour, { 'A2A-Version': '0.3' })).code,
    -32009,
  );
  assert.equal((await code('GetTask', { id: 'task-1' })).code, -32001);
  assert.equal((await code('CancelTask', { id: 'task-1' })).code, -32001);
  assert.equal((await code('SendStreamingMessage', tableForFour)).code, -32004);
  assert.equal((await code('GetExtendedAgentCard', {})).code, -32007);
  assert.equal((await code('Nonsense', {})).code, -32601);
  const scope = await code(
    'SendMessage',
    message([{ data: { skill: 'cook_dinner', goal: 'Dinner' } }]),
  );
  assert.equal(scope.code, -32602);
  assert.equal(scope.data[0].reason, 'HANDOFF_SCOPE');
  assert.equal(
    (
      await code(
        'SendMessage',
        message([
          {
            data: {
              skill: 'book_table',
              goal: 'A table',
              fields: { people: 99 },
            },
          },
        ]),
      )
    ).data[0].reason,
    'HANDOFF_INVALID',
  );
  assert.equal(
    (
      await code(
        'SendMessage',
        message([
          {
            data: { skill: 'book_table', goal: 'Book at https://evil.example' },
          },
        ]),
      )
    ).data[0].reason,
    'A2A_INVALID',
  );
  assert.equal(
    (
      await code(
        'SendMessage',
        message([{ url: 'https://evil.example/menu.pdf' }]),
      )
    ).code,
    -32005,
  );
  assert.equal(
    (
      await code('SendMessage', {
        ...tableForFour,
        configuration: { acceptedOutputModes: ['image/png'] },
      })
    ).code,
    -32005,
  );
  assert.equal(
    (
      await code('SendMessage', {
        message: { ...tableForFour.message, taskId: 'task-1' },
      })
    ).code,
    -32001,
  );
  assert.equal(
    (
      await code('SendMessage', {
        message: { ...tableForFour.message, role: 'ROLE_AGENT' },
      })
    ).code,
    -32602,
  );

  const post = (body, headers = {}) =>
    handler(
      new Request('https://resto.test/pagesquire/a2a', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      }),
    );
  assert.equal((await (await post('{')).json()).error.code, -32700);
  assert.equal(
    (await (await post('{"jsonrpc":"1.0","method":"SendMessage"}')).json())
      .error.code,
    -32600,
  );
  assert.equal(
    (await post('{}', { 'content-type': 'text/plain' })).status,
    415,
  );
  assert.equal(
    (await handler(new Request('https://resto.test/pagesquire/a2a'))).status,
    405,
  );
  // The version may also come as a query parameter.
  const query = await handler(
    new Request('https://resto.test/pagesquire/a2a?A2A-Version=1.0', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'q',
        method: 'SendMessage',
        params: tableForFour,
      }),
    }),
  );
  assert.equal((await query.json()).id, 'q');
});

test("the visitor arrives from an agent's link and the assistant continues", async () => {
  const store = new MemoryLinkStore();
  const { manager, handler } = site({ store });
  const answer = await rpc(handler, 'SendMessage', tableForFour);
  const code = answer.result.message.parts[1].data.url.split('#psq-agent=')[1];
  const calls = [];
  const engine = new ConversationEngine({
    provider: {
      async complete(messages, capabilities) {
        calls.push({ messages, capabilities: capabilities.map((c) => c.id) });
        return {
          text: 'Shall I book 4 people on 29 October?',
          emotion: 'happy',
          finished: true,
          toolCalls: [],
        };
      },
    },
    manifest: { schemaVersion: '0.1', capabilities: createLinkCapabilities() },
    links: manager,
    locale: 'id',
  });
  await engine.handle(
    {
      protocolVersion: '0.1',
      requestId: 'arrive',
      linkCode: code,
      snapshot: {
        protocolVersion: '0.1',
        id: 'snapshot-1',
        url: 'https://resto.test/reservations',
        title: 'Restoran Laut',
        text: 'Reservasi',
        targets: [],
        truncated: { text: false, targets: false },
      },
      capabilityIds: ['link.handoff', 'link.return'],
    },
    null,
    ['link.handoff', 'link.return'],
  );
  const sent = calls[0].messages;
  assert.equal(
    sent.at(-2).content,
    'Permintaan dari agen AI: A table for 4 on 29 October',
  );
  assert.deepEqual(JSON.parse(sent.at(-1).content).untrustedHandoff, {
    from: 'an AI agent (A2A)',
    skill: 'book_table',
    fields: { date: '2026-10-29', people: 4 },
  });
  // There is no partner to send the visitor back to.
  assert.deepEqual(calls[0].capabilities, []);

  // Turning the interface off voids open links.
  const again = await rpc(handler, 'SendMessage', tableForFour);
  const off = site({ store, a2a: null }).manager;
  assert.equal(
    await off.redeem(
      again.result.message.parts[1].data.url.split('#psq-agent=')[1],
    ),
    undefined,
  );
});

test('agents may hold at most half of the open codes', async () => {
  const { store, handler } = site();
  await store.transaction((data) => {
    for (let index = 0; index < 500; index++)
      data.tickets[`agent-${index}`] = {
        kind: 'agent',
        link: 'a2a',
        skill: 'book_table',
        goal: 'A table',
        fields: {},
        expiresAt: Date.now() + 600_000,
      };
  });
  const busy = await rpc(handler, 'SendMessage', tableForFour);
  assert.equal(busy.error.code, -32603);
  assert.equal(busy.error.data[0].reason, 'LINK_BUSY');
});
