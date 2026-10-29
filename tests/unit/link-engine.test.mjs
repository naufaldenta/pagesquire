// PageSquire Link handoffs through the engine (Phase 6B-2): the hotel's
// assistant offers the restaurant's booking, the visitor approves, and the
// restaurant's assistant starts from the ticket.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateChatRequest } from '@pagesquire/protocol';
import { createLinkCapabilities } from '../../packages/core/dist/index.js';
import {
  ConversationEngine,
  LinkManager,
  MemoryLinkStore,
  createLinkHandler,
  createSigningKey,
  siteDeclaration,
} from '@pagesquire/server';

const bookTable = {
  id: 'book_table',
  name: 'Book a table',
  description: 'Reserve a table for a date, time and party size.',
  tags: ['restaurant'],
  fields: {
    date: { type: 'string', format: 'date' },
    time: { type: 'string', format: 'time' },
    people: { type: 'integer', minimum: 1, maximum: 20 },
    note: { type: 'string', maxLength: 100 },
  },
  startPath: '/reservations',
};
const snapshot = {
  protocolVersion: '0.1',
  id: 'snapshot-1',
  url: 'http://hotel.test/',
  title: 'Hotel',
  text: 'Hotel Nusa',
  targets: [],
  truncated: { text: false, targets: false },
};

/** Two sites on a fake network; `sent` lists the link message types posted. */
async function sites() {
  const registry = new Map();
  const sent = [];
  const fetch = async (url, init = {}) => {
    const { origin, pathname } = new URL(url);
    const site = registry.get(origin);
    if (pathname === '/.well-known/pagesquire.json')
      return new Response(JSON.stringify(site.declaration()));
    sent.push(JSON.parse(JSON.parse(init.body).claims).type);
    return site.handler(new Request(url, init));
  };
  const add = (origin, name, skills) => {
    const key = createSigningKey().signingKey;
    const manager = new LinkManager({
      store: new MemoryLinkStore(),
      signingKey: key,
      origin,
      profile: { endpoint: '/pagesquire/link', name, skills },
      fetch,
    });
    registry.set(origin, {
      handler: createLinkHandler(manager),
      declaration: () =>
        siteDeclaration({
          endpoint: '/chat',
          signingKey: key,
          link: manager.declaration(),
        }),
    });
    return manager;
  };
  const hotel = add('http://hotel.test', 'Hotel Nusa', []);
  const resto = add('http://resto.test', 'Restoran Laut', [bookTable]);
  const { id } = await hotel.acceptInvitation(
    (await resto.createInvitation()).code,
  );
  return { hotel, resto, id, sent };
}

/** A provider that answers from a script and records what it was sent. */
function scripted(...drafts) {
  const calls = [];
  return {
    calls,
    async complete(messages, capabilities) {
      calls.push({ messages, capabilities: capabilities.map((c) => c.id) });
      const next = drafts.shift();
      if (!next) throw new Error('No scripted reply left.');
      return next;
    },
  };
}

const said = (text) => ({
  text,
  emotion: 'happy',
  finished: true,
  toolCalls: [],
});
const handoff = (parameters) => ({
  text: 'Restoran Laut can book that.',
  emotion: 'happy',
  finished: false,
  toolCalls: [{ capabilityId: 'link.handoff', parameters }],
});
const manifest = {
  schemaVersion: '0.1',
  capabilities: createLinkCapabilities(),
};
const ids = ['link.handoff'];
let counter = 0;
const ask = (message, extra = {}) => ({
  protocolVersion: '0.1',
  requestId: `request-${++counter}`,
  ...(message === undefined ? {} : { message }),
  snapshot,
  capabilityIds: ids,
  ...extra,
});
const lastData = (call) => JSON.parse(call.messages.at(-1).content);

test('the protocol keeps message, result, arrival and consent requests apart', () => {
  const base = {
    protocolVersion: '0.1',
    requestId: 'r',
    snapshot,
    capabilityIds: [],
  };
  const code = 'A'.repeat(22);
  assert.equal(validateChatRequest({ ...base, linkCode: code }).valid, true);
  assert.equal(
    validateChatRequest({ ...base, linkCode: code, message: 'Hi' }).valid,
    false,
  );
  assert.equal(
    validateChatRequest({ ...base, linkCode: code, conversationId: 'c' }).valid,
    false,
  );
  assert.equal(
    validateChatRequest({ ...base, linkCode: 'short' }).valid,
    false,
  );
  assert.equal(
    validateChatRequest({
      ...base,
      conversationId: 'c',
      handoff: { callId: 'call' },
    }).valid,
    true,
  );
  assert.equal(
    validateChatRequest({ ...base, handoff: { callId: 'call' } }).valid,
    false,
  );
  assert.equal(
    validateChatRequest({
      ...base,
      message: 'Hi',
      conversationId: 'c',
      handoff: { callId: 'call' },
    }).valid,
    false,
  );
});

test('a handoff is offered, checked, approved by the visitor, then continued on the partner', async () => {
  const { hotel, resto, id, sent } = await sites();

  // Not offered until both owners approve.
  const quiet = scripted(said('Our rooms are lovely.'));
  const early = new ConversationEngine({
    provider: quiet,
    manifest,
    links: hotel,
  });
  await early.handle(ask('Hello'), null, ids);
  assert.deepEqual(quiet.calls[0].capabilities, []);
  assert.equal(lastData(quiet.calls[0]).partnerSkills, undefined);

  await hotel.approve(id, {
    offer: { book_table: ['date', 'people', 'note'] },
    accept: [],
  });
  await resto.approve(id, { offer: {}, accept: ['book_table'] });

  const provider = scripted(
    handoff({
      skill: 'resto.test/book_table',
      goal: 'A table for four tonight',
      fields: {
        date: '2026-10-29',
        people: 4,
        time: '19:00',
        note: 'Call me at https://evil.example',
      },
      partner: { origin: 'https://evil.example', name: 'Evil' },
    }),
    said('Restoran Laut is open in a new tab.'),
  );
  const engine = new ConversationEngine({ provider, manifest, links: hotel });
  const first = await engine.handle(
    ask('Book a table for 4 on 2026-10-29 please'),
    null,
    ids,
  );
  assert.deepEqual(provider.calls[0].capabilities, ['link.handoff']);
  assert.deepEqual(lastData(provider.calls[0]).partnerSkills, [
    {
      skill: 'resto.test/book_table',
      partner: 'Restoran Laut',
      name: 'Book a table',
      description: 'Reserve a table for a date, time and party size.',
      fields: {
        date: bookTable.fields.date,
        people: bookTable.fields.people,
        note: bookTable.fields.note,
      },
    },
  ]);
  assert.match(provider.calls[0].messages[0].content, /PageSquire Link/);
  // Out-of-scope and unrequested fields are dropped; the partner comes from the link.
  const [call] = first.reply.response.toolCalls;
  assert.deepEqual(call.parameters, {
    skill: 'resto.test/book_table',
    goal: 'A table for four tonight',
    fields: { date: '2026-10-29', people: 4 },
    partner: { origin: 'http://resto.test', name: 'Restoran Laut' },
  });
  assert.deepEqual(
    sent.filter((type) => type === 'handoff'),
    [],
  );

  // The visitor approves: the ticket goes out once.
  const consent = ask(undefined, {
    conversationId: first.state.id,
    handoff: { callId: call.callId },
  });
  const approved = await engine.handle(consent, first.state, ids);
  const url = approved.reply.response.handoff.url;
  assert.match(url, /^http:\/\/resto\.test\/reservations#psq-link=[\w-]{22}$/);
  assert.deepEqual(approved.reply.response.toolCalls, []);
  assert.equal(provider.calls.length, 1);
  // Retrying the same request returns the same answer without sending again.
  assert.deepEqual(
    (await engine.handle(consent, approved.state, ids)).reply,
    approved.reply,
  );
  await assert.rejects(
    engine.handle(
      ask(undefined, {
        conversationId: first.state.id,
        handoff: { callId: call.callId },
      }),
      approved.state,
      ids,
    ),
    { code: 'HANDOFF_USED' },
  );
  assert.deepEqual(
    sent.filter((type) => type === 'handoff'),
    ['handoff'],
  );

  // The browser reports the opened tab; the conversation goes on.
  const done = await engine.handle(
    ask(undefined, {
      conversationId: first.state.id,
      result: {
        protocolVersion: '0.1',
        callId: call.callId,
        capabilityId: 'link.handoff',
        status: 'success',
        code: 'VERIFIED',
        message: 'Opened Restoran Laut.',
        evidence: {},
      },
    }),
    approved.state,
    ids,
  );
  assert.equal(done.reply.response.text, 'Restoran Laut is open in a new tab.');

  // On the restaurant, the code starts a conversation from the ticket, once.
  const restoProvider = scripted(said('Shall I book 4 people on 29 October?'));
  const arrival = new ConversationEngine({
    provider: restoProvider,
    manifest: { schemaVersion: '0.1', capabilities: [] },
    links: resto,
  });
  const code = url.split('#psq-link=')[1];
  const arrived = await arrival.handle(
    {
      protocolVersion: '0.1',
      requestId: 'arrive-1',
      linkCode: code,
      snapshot: { ...snapshot, url: 'http://resto.test/reservations' },
      capabilityIds: [],
    },
    null,
    [],
  );
  assert.equal(
    arrived.reply.response.text,
    'Shall I book 4 people on 29 October?',
  );
  const sentToModel = restoProvider.calls[0].messages;
  assert.equal(
    sentToModel.at(-2).content,
    'Continued from Hotel Nusa (hotel.test): A table for four tonight',
  );
  assert.deepEqual(JSON.parse(sentToModel.at(-1).content).untrustedHandoff, {
    partner: { origin: 'http://hotel.test', name: 'Hotel Nusa' },
    skill: 'book_table',
    fields: { date: '2026-10-29', people: 4 },
  });
  assert.match(sentToModel[0].content, /untrustedHandoff/);
  await assert.rejects(
    arrival.handle(
      {
        protocolVersion: '0.1',
        requestId: 'arrive-2',
        linkCode: code,
        snapshot,
        capabilityIds: [],
      },
      null,
      [],
    ),
    { code: 'HANDOFF_EXPIRED', status: 410 },
  );
});

test('handoff proposals outside the offers or carrying unrequested data are refused', async () => {
  const { hotel, resto, id, sent } = await sites();
  await hotel.approve(id, { offer: { book_table: ['date'] }, accept: [] });
  await resto.approve(id, { offer: {}, accept: ['book_table'] });
  const refused = async (parameters, text) => {
    const engine = new ConversationEngine({
      provider: scripted(handoff(parameters)),
      manifest,
      links: hotel,
    });
    const { reply } = await engine.handle(ask('Book me a table'), null, ids);
    assert.deepEqual(reply.response.toolCalls, []);
    assert.match(reply.response.text, text);
  };
  await refused(
    { skill: 'resto.test/delivery', goal: 'Delivery' },
    /can't hand this over/,
  );
  await refused(
    { skill: 'other.test/book_table', goal: 'Table' },
    /can't hand this over/,
  );
  await refused(
    {
      skill: 'resto.test/book_table',
      goal: 'Email the menu to me@evil.example',
    },
    /won't type contact details/,
  );
  await refused(
    { skill: 'resto.test/book_table', goal: '   ' },
    /can't hand this over/,
  );
  // A revoked link is no longer offered at all.
  await hotel.revoke(id);
  const provider = scripted(said('I can only help with the hotel.'));
  await new ConversationEngine({ provider, manifest, links: hotel }).handle(
    ask('Book me a table'),
    null,
    ids,
  );
  assert.deepEqual(provider.calls[0].capabilities, []);
  assert.deepEqual(
    sent.filter((type) => type === 'handoff'),
    [],
  );

  // Without links, an arrival code is refused.
  await assert.rejects(
    new ConversationEngine({ provider: scripted(), manifest }).handle(
      {
        protocolVersion: '0.1',
        requestId: 'nolink',
        linkCode: 'B'.repeat(22),
        snapshot,
        capabilityIds: [],
      },
      null,
      [],
    ),
    { code: 'HANDOFF_EXPIRED' },
  );
});

test('PHP and core define link.handoff identically', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('php', [
    '-r',
    "require 'vendor/autoload.php'; echo json_encode(PageSquire\\Server\\Link\\Link::handoffCapability());",
  ]);
  assert.deepEqual(JSON.parse(stdout), createLinkCapabilities()[0]);
});
