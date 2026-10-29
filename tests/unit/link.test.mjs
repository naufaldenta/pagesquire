import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  FileLinkStore,
  LINK_CONTEXT,
  LinkManager,
  MemoryLinkStore,
  createLinkHandler,
  createSigningKey,
  invitationProof,
  linkOriginAllowed,
  linkValueAllowed,
  readLinkDeclaration,
  readLinkInvitation,
  readLinkSkills,
  signLinkEnvelope,
  signWithSiteKey,
  siteDeclaration,
  verifyLinkEnvelope,
  verifySiteSignature,
} from '@pagesquire/server';

const vector = JSON.parse(
  await readFile(new URL('../fixtures/link.json', import.meta.url)),
);

const bookTable = {
  id: 'book_table',
  name: 'Book a table',
  description: 'Reserve a table for a date, time and party size.',
  tags: ['restaurant'],
  examples: ['Book a table for 4 tonight at 7'],
  fields: {
    date: { type: 'string', format: 'date' },
    time: { type: 'string', pattern: '^[0-2][0-9]:[0-5][0-9]$' },
    people: { type: 'integer', minimum: 1, maximum: 20 },
  },
  startPath: '/reservations',
};
const findRoom = {
  id: 'find_room',
  name: 'Find a room',
  description: 'Show rooms for dates.',
  tags: ['hotel'],
  fields: { checkIn: { type: 'string', format: 'date' } },
  startPath: '/rooms',
};

/**
 * Two sites on a fake network: each serves its declaration and link
 * endpoint; `down` takes a site offline.
 */
function network(now = Date.now) {
  const sites = new Map();
  const down = new Set();
  const fetch = async (url, init = {}) => {
    const { origin, pathname } = new URL(url);
    const site = sites.get(origin);
    if (!site || down.has(origin)) throw new TypeError('fetch failed');
    if (pathname === '/.well-known/pagesquire.json')
      return new Response(JSON.stringify(site.declaration()));
    if (pathname === '/pagesquire/link')
      return site.handler(
        new Request(url, { ...init, method: init.method ?? 'GET' }),
      );
    return new Response('{}', { status: 404 });
  };
  const add = (origin, name, skills, key = createSigningKey().signingKey) => {
    const manager = new LinkManager({
      store: new MemoryLinkStore(),
      signingKey: key,
      origin,
      profile: { endpoint: '/pagesquire/link', name, skills },
      fetch,
      now,
    });
    const site = {
      manager,
      key,
      handler: createLinkHandler(manager),
      declaration: () =>
        siteDeclaration({
          endpoint: '/pagesquire/chat',
          signingKey: site.key,
          link: manager.declaration(),
        }),
    };
    sites.set(origin, site);
    return site;
  };
  return { add, down, fetch, sites };
}

async function paired(now = Date.now) {
  const net = network(now);
  const hotel = net.add('http://hotel.test', 'Hotel Nusa', [findRoom]);
  const resto = net.add('http://resto.test', 'Restoran Laut', [bookTable]);
  const { code } = await resto.manager.createInvitation();
  const accepted = await hotel.manager.acceptInvitation(code);
  return { net, hotel, resto, id: accepted.id, accepted };
}

test('envelopes and invitation proofs match the shared vector', () => {
  assert.equal(
    signWithSiteKey(LINK_CONTEXT, vector.claims, vector.signingKey),
    vector.signature,
  );
  assert.equal(
    verifySiteSignature(
      LINK_CONTEXT,
      vector.claims,
      vector.signature,
      vector.publicKey,
    ),
    true,
  );
  // The context separates link signatures from action-call signatures.
  assert.equal(
    verifySiteSignature(
      'pagesquire-call-v1.',
      vector.claims,
      vector.signature,
      vector.publicKey,
    ),
    false,
  );
  const claims = verifyLinkEnvelope(
    { claims: vector.claims, value: vector.signature },
    vector.publicKey,
    { to: 'http://resto.test', from: 'http://hotel.test', type: 'approve' },
    1830000010 * 1000,
  );
  assert.deepEqual(claims.body.accept, ['book_table']);
  const { invitation } = vector;
  assert.equal(
    invitationProof(invitation.keyHash, invitation.from, invitation.nonce),
    invitation.proof,
  );
});

test('envelopes are refused when forged, expired, misaddressed or malformed', () => {
  const at = 1830000010 * 1000;
  const envelope = { claims: vector.claims, value: vector.signature };
  const expected = { to: 'http://resto.test' };
  const code = (fn) => {
    try {
      fn();
    } catch (error) {
      return error.code;
    }
    return 'accepted';
  };
  const other = createSigningKey().publicKey;
  assert.equal(
    code(() => verifyLinkEnvelope(envelope, other, expected, at)),
    'LINK_SIGNATURE',
  );
  assert.equal(
    code(() =>
      verifyLinkEnvelope(
        {
          claims: vector.claims.replace('café', 'cafe'),
          value: vector.signature,
        },
        vector.publicKey,
        expected,
        at,
      ),
    ),
    'LINK_SIGNATURE',
  );
  assert.equal(
    code(() =>
      verifyLinkEnvelope(
        envelope,
        vector.publicKey,
        expected,
        (1830000300 + 121) * 1000,
      ),
    ),
    'LINK_EXPIRED',
  );
  assert.equal(
    code(() =>
      verifyLinkEnvelope(
        envelope,
        vector.publicKey,
        { to: 'http://other.test' },
        at,
      ),
    ),
    'LINK_INVALID',
  );
  assert.equal(
    code(() =>
      verifyLinkEnvelope(
        envelope,
        vector.publicKey,
        { ...expected, type: 'revoke' },
        at,
      ),
    ),
    'LINK_INVALID',
  );
  assert.equal(
    code(() =>
      verifyLinkEnvelope(
        { claims: '{}', value: 'x' },
        vector.publicKey,
        expected,
        at,
      ),
    ),
    'LINK_INVALID',
  );
});

test('partner origins, invitations, skills and declarations are validated strictly', () => {
  for (const origin of [
    'https://shop.example',
    'http://localhost:8000',
    'http://127.0.0.1:3000',
    'http://shop.test',
  ])
    assert.equal(linkOriginAllowed(origin), true, origin);
  for (const origin of [
    'http://shop.example',
    'https://shop.example/',
    'ftp://shop.test',
    'not a url',
  ])
    assert.equal(linkOriginAllowed(origin), false, origin);

  const code = `psq1.${Buffer.from('https://hotel.example').toString('base64url')}.inv_${'a'.repeat(22)}.${'b'.repeat(43)}`;
  assert.deepEqual(readLinkInvitation(code), {
    origin: 'https://hotel.example',
    id: `inv_${'a'.repeat(22)}`,
    secret: 'b'.repeat(43),
  });
  for (const bad of [
    '',
    'psq1.x.y',
    code.replace('psq1', 'psq2'),
    code.replace('inv_', 'lnk_'),
    code.slice(0, -1),
  ])
    assert.equal(readLinkInvitation(bad), undefined, bad);

  assert.deepEqual(readLinkSkills([bookTable]), [bookTable]);
  for (const bad of [
    [{ ...bookTable, id: 'Book Table' }],
    [bookTable, bookTable],
    [{ ...bookTable, startPath: 'https://evil.example/' }],
    [{ ...bookTable, fields: { date: { type: 'object' } } }],
    [{ ...bookTable, fields: { date: { type: 'string', pattern: '(' } } }],
    [{ ...bookTable, extra: true }],
    [
      {
        ...bookTable,
        fields: Object.fromEntries(
          Array.from({ length: 11 }, (_, i) => [`f${i}`, { type: 'boolean' }]),
        ),
      },
    ],
  ])
    assert.equal(
      readLinkSkills(bad),
      undefined,
      JSON.stringify(bad).slice(0, 80),
    );

  const declaration = siteDeclaration({
    endpoint: '/pagesquire/chat',
    signingKey: vector.signingKey,
    link: {
      endpoint: '/pagesquire/link',
      name: 'Restoran Laut',
      skills: [bookTable],
    },
  });
  assert.deepEqual(declaration.features, ['trustedInput', 'link']);
  assert.deepEqual(readLinkDeclaration(declaration, 'http://resto.test'), {
    origin: 'http://resto.test',
    name: 'Restoran Laut',
    endpoint: 'http://resto.test/pagesquire/link',
    publicKey: vector.publicKey,
    skills: [bookTable],
  });
  assert.equal(
    readLinkDeclaration(
      { ...declaration, features: ['trustedInput'] },
      'http://resto.test',
    ),
    undefined,
  );
});

test('two sites pair with an invitation and become active once both owners approve', async () => {
  const { hotel, resto, id, accepted } = await paired();
  assert.equal(accepted.status, 'pending');
  assert.equal(accepted.partner.name, 'Restoran Laut');
  const [inviterSide] = await resto.manager.list();
  assert.equal(inviterSide.id, id);
  assert.equal(inviterSide.role, 'inviter');
  assert.equal(inviterSide.partner.origin, 'http://hotel.test');

  // The hotel offers the restaurant's booking and may carry three fields.
  const first = await hotel.manager.approve(id, {
    offer: { book_table: ['date', 'time', 'people'] },
    accept: [],
  });
  assert.equal(first.notified, true);
  assert.equal(first.record.status, 'pending');
  assert.equal((await resto.manager.get(id)).theirs.approved, true);

  // The restaurant accepts handoffs into its booking.
  const second = await resto.manager.approve(id, {
    offer: {},
    accept: ['book_table'],
  });
  assert.equal(second.record.status, 'active');
  const hotelSide = await hotel.manager.get(id);
  assert.equal(hotelSide.status, 'active');
  assert.deepEqual(hotelSide.theirs.accept, ['book_table']);
});

test('invitations are single use, expire and need the secret', async () => {
  const net = network();
  const hotel = net.add('http://hotel.test', 'Hotel Nusa', [findRoom]);
  const resto = net.add('http://resto.test', 'Restoran Laut', [bookTable]);
  const third = net.add('http://third.test', 'Third', []);
  const { code } = await resto.manager.createInvitation();
  await hotel.manager.acceptInvitation(code);
  await assert.rejects(third.manager.acceptInvitation(code), {
    code: 'PARTNER_REJECTED',
  });
  const wrongSecret = (await resto.manager.createInvitation()).code.replace(
    /.$/,
    (c) => (c === 'A' ? 'B' : 'A'),
  );
  await assert.rejects(third.manager.acceptInvitation(wrongSecret), {
    code: 'PARTNER_REJECTED',
  });
  await assert.rejects(
    resto.manager.acceptInvitation(
      (await resto.manager.createInvitation()).code,
    ),
    {
      code: 'INVITATION_INVALID',
    },
  );
  await assert.rejects(hotel.manager.acceptInvitation('psq1.nope'), {
    code: 'INVITATION_INVALID',
  });
  assert.equal((await third.manager.list()).length, 0);
});

test('an expired invitation is refused', async () => {
  let now = Date.UTC(2026, 9, 29);
  const net = network(() => now);
  const hotel = net.add('http://hotel.test', 'Hotel Nusa', [findRoom]);
  const resto = net.add('http://resto.test', 'Restoran Laut', [bookTable]);
  const { code } = await resto.manager.createInvitation(1);
  now += 2 * 3_600_000;
  await assert.rejects(hotel.manager.acceptInvitation(code), {
    code: 'PARTNER_REJECTED',
  });
});

test("scopes only name the partner skills and fields, and this site's own skills", async () => {
  const { hotel, id } = await paired();
  for (const scope of [
    { offer: { unknown: [] }, accept: [] },
    { offer: { book_table: ['name'] }, accept: [] },
    { offer: {}, accept: ['book_table'] },
    { offer: [], accept: [] },
  ])
    await assert.rejects(
      hotel.manager.approve(id, scope),
      { code: 'INVALID_SCOPE' },
      JSON.stringify(scope),
    );
  await assert.rejects(
    hotel.manager.approve('lnk_missingmissingmiss', { offer: {}, accept: [] }),
    {
      code: 'LINK_UNKNOWN',
    },
  );
});

test('revoking ends the link on both sides; an offline partner still revokes locally', async () => {
  const { net, hotel, resto, id } = await paired();
  await hotel.manager.approve(id, {
    offer: { book_table: ['date'] },
    accept: [],
  });
  await resto.manager.approve(id, { offer: {}, accept: ['book_table'] });
  const revoked = await resto.manager.revoke(id);
  assert.equal(revoked.notified, true);
  assert.equal((await hotel.manager.get(id)).status, 'revoked');
  assert.equal((await hotel.manager.get(id)).revokedBy, 'partner');
  await assert.rejects(hotel.manager.approve(id, { offer: {}, accept: [] }), {
    code: 'LINK_REVOKED',
  });

  const second = await paired();
  second.net.down.add('http://resto.test');
  const offline = await second.hotel.manager.revoke(second.id);
  assert.equal(offline.notified, false);
  assert.equal(offline.record.status, 'revoked');
  assert.ok(net);
});

test('replayed, foreign and unknown-link messages are refused at the endpoint', async () => {
  const { hotel, resto, id } = await paired();
  const envelope = signLinkEnvelope(
    {
      type: 'approve',
      from: 'http://hotel.test',
      to: 'http://resto.test',
      link: id,
      body: { accept: [] },
    },
    hotel.key,
  );
  const post = (body) =>
    resto.handler(
      new Request('http://resto.test/pagesquire/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await post(envelope)).status, 200);
  const replay = await post(envelope);
  assert.equal(replay.status, 409);
  assert.equal((await replay.json()).error.code, 'LINK_REPLAYED');

  const stranger = createSigningKey().signingKey;
  const forged = signLinkEnvelope(
    {
      type: 'revoke',
      from: 'http://hotel.test',
      to: 'http://resto.test',
      link: id,
      body: {},
    },
    stranger,
  );
  assert.equal((await post(forged)).status, 401);
  assert.equal((await resto.manager.get(id)).status, 'pending');

  const unknown = signLinkEnvelope(
    {
      type: 'revoke',
      from: 'http://hotel.test',
      to: 'http://resto.test',
      link: 'lnk_unknownunknownunkn',
      body: {},
    },
    hotel.key,
  );
  assert.equal((await post(unknown)).status, 404);
  const response = await resto.handler(
    new Request('http://resto.test/pagesquire/link'),
  );
  assert.equal(response.status, 405);
  const text = await resto.handler(
    new Request('http://resto.test/pagesquire/link', {
      method: 'POST',
      body: 'x',
    }),
  );
  assert.equal(text.status, 415);
});

test('a rotated partner key is picked up from its declaration', async () => {
  const { hotel, resto, id } = await paired();
  hotel.key = createSigningKey().signingKey;
  const envelope = signLinkEnvelope(
    {
      type: 'approve',
      from: 'http://hotel.test',
      to: 'http://resto.test',
      link: id,
      body: { accept: [] },
    },
    hotel.key,
  );
  await resto.manager.receive(envelope);
  assert.equal(
    (await resto.manager.get(id)).partner.publicKey,
    siteDeclaration({ endpoint: '/c', signingKey: hotel.key }).publicKey,
  );
});

test('the file store keeps links across managers', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pagesquire-link-'));
  try {
    const file = path.join(directory, 'links.json');
    const store = new FileLinkStore(file);
    await store.transaction((data) => {
      data.links.lnk_filefilefilefilefil = { id: 'lnk_filefilefilefilefil' };
    });
    const again = new FileLinkStore(file);
    assert.deepEqual(
      await again.transaction((data) => Object.keys(data.links)),
      ['lnk_filefilefilefilefil'],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// Phase 6B: handoff tickets.

test('field values follow the shared vector', () => {
  for (const { schema, value, valid } of vector.values)
    assert.equal(
      linkValueAllowed(schema, value),
      valid,
      JSON.stringify({ schema, value }),
    );
});

/** A paired hotel and restaurant where the hotel may hand visitors into booking. */
async function handing(now = Date.now) {
  const sites = await paired(now);
  await sites.hotel.manager.approve(sites.id, {
    offer: { book_table: ['date', 'people'] },
    accept: [],
  });
  await sites.resto.manager.approve(sites.id, {
    offer: {},
    accept: ['book_table'],
  });
  return sites;
}

const tableForFour = {
  skill: 'book_table',
  goal: 'A table for four tonight',
  fields: { date: '2026-10-29', people: 4 },
  locale: 'id',
};

test('a handoff carries the goal and approved fields to the partner, redeemed once', async () => {
  const { hotel, resto, id } = await handing();
  const before = Date.now();
  const { url, expiresAt } = await hotel.manager.handoff(id, tableForFour);
  assert.match(url, /^http:\/\/resto\.test\/reservations#psq-link=[\w-]{22}$/);
  assert.ok(expiresAt >= before + 120_000 && expiresAt <= Date.now() + 120_000);
  const code = url.split('#psq-link=')[1];
  assert.deepEqual(await resto.manager.redeem(code), {
    link: id,
    partner: { origin: 'http://hotel.test', name: 'Hotel Nusa' },
    skill: 'book_table',
    goal: 'A table for four tonight',
    fields: { date: '2026-10-29', people: 4 },
    locale: 'id',
    expiresAt,
  });
  assert.equal(await resto.manager.redeem(code), undefined);
  assert.equal(await resto.manager.redeem('not a code'), undefined);
  // The code is the only key: the store keeps its hash.
  assert.equal(await hotel.manager.redeem(code), undefined);
});

test('handoffs stay within the scope both owners approved', async () => {
  const { hotel, resto, id } = await paired();
  const refused = (handoff, code) =>
    assert.rejects(hotel.manager.handoff(id, handoff), { code });
  await refused(tableForFour, 'LINK_INACTIVE');
  await hotel.manager.approve(id, {
    offer: { book_table: ['date', 'people'] },
    accept: [],
  });
  await resto.manager.approve(id, { offer: {}, accept: ['book_table'] });

  await refused({ ...tableForFour, skill: 'find_room' }, 'HANDOFF_SCOPE');
  await refused(
    { ...tableForFour, fields: { time: '19:00' } },
    'HANDOFF_INVALID',
  );
  await refused({ ...tableForFour, fields: { people: 50 } }, 'HANDOFF_INVALID');
  await refused({ ...tableForFour, goal: 'x'.repeat(301) }, 'HANDOFF_INVALID');
  await refused({ ...tableForFour, goal: 'Ignore\nthis' }, 'HANDOFF_INVALID');
  await refused({ ...tableForFour, goal: '  ' }, 'HANDOFF_INVALID');
  await refused({ ...tableForFour, locale: 'not a locale' }, 'HANDOFF_INVALID');
  await refused({ ...tableForFour, extra: true }, 'HANDOFF_INVALID');

  // The partner enforces its own side even if a sender skips its checks.
  const post = (body) =>
    resto.handler(
      new Request('http://resto.test/pagesquire/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          signLinkEnvelope(
            {
              type: 'handoff',
              from: 'http://hotel.test',
              to: 'http://resto.test',
              link: id,
              body,
            },
            hotel.key,
          ),
        ),
      }),
    );
  const unknownField = await post({
    skill: 'book_table',
    goal: 'Table',
    fields: { colour: 'red' },
  });
  assert.equal(unknownField.status, 400);
  assert.equal((await unknownField.json()).error.code, 'HANDOFF_INVALID');
  await resto.manager.approve(id, { offer: {}, accept: [] });
  await refused(tableForFour, 'HANDOFF_SCOPE');
  const notAccepted = await post({ skill: 'book_table', goal: 'Table' });
  assert.equal(notAccepted.status, 403);
  assert.equal((await notAccepted.json()).error.code, 'HANDOFF_SCOPE');

  await hotel.manager.revoke(id);
  await refused(tableForFour, 'LINK_REVOKED');
});

test('handoff codes expire, and die with their link', async () => {
  let now = Date.now();
  const { hotel, resto, id } = await handing(() => now);
  const first = await hotel.manager.handoff(id, tableForFour);
  now += 121_000;
  assert.equal(
    await resto.manager.redeem(first.url.split('#psq-link=')[1]),
    undefined,
  );
  const second = await hotel.manager.handoff(id, tableForFour);
  await resto.manager.revoke(id);
  assert.equal(
    await resto.manager.redeem(second.url.split('#psq-link=')[1]),
    undefined,
  );
});
