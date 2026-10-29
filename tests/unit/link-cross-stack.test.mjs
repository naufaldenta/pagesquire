// PageSquire Link across stacks: a Node site and a native PHP site, each
// with its own server, key and store, pair over real HTTP.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import {
  FileLinkStore,
  LinkManager,
  createLinkHandler,
  createSigningKey,
  siteDeclaration,
} from '@pagesquire/server';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const script = path.join(root, 'tests/fixtures/link-php-site.php');

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

let directory;
let php;
let phpEnv;
let node;
let nodeServer;

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'pagesquire-link-x-'));
  const phpPort = await freePort();
  phpEnv = {
    ...process.env,
    PSQ_ORIGIN: `http://127.0.0.1:${phpPort}`,
    PSQ_KEY: createSigningKey().signingKey,
    PSQ_NAME: 'Restoran Laut (PHP)',
    PSQ_STORE: path.join(directory, 'php-links.json'),
  };
  php = spawn('php', ['-S', `127.0.0.1:${phpPort}`, script], {
    env: phpEnv,
    stdio: 'ignore',
  });

  const key = createSigningKey().signingKey;
  nodeServer = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const url = `${node.origin}${incoming.url}`;
    const response = incoming.url.startsWith('/.well-known/pagesquire.json')
      ? new Response(
          JSON.stringify(
            siteDeclaration({
              endpoint: '/pagesquire/chat',
              signingKey: key,
              link: node.manager.declaration(),
            }),
          ),
        )
      : await node.handler(
          new Request(url, {
            method: incoming.method,
            headers: incoming.headers,
            ...(incoming.method === 'POST'
              ? { body: Buffer.concat(chunks) }
              : {}),
          }),
        );
    outgoing.writeHead(response.status, { 'content-type': 'application/json' });
    outgoing.end(await response.text());
  });
  await new Promise((resolve) => nodeServer.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${nodeServer.address().port}`;
  const manager = new LinkManager({
    store: new FileLinkStore(path.join(directory, 'node-links.json')),
    signingKey: key,
    origin,
    profile: {
      endpoint: '/pagesquire/link',
      name: 'Hotel Nusa (Node)',
      skills: [
        {
          id: 'find_room',
          name: 'Find a room',
          description: 'Show rooms for dates.',
          tags: ['hotel'],
          fields: { checkIn: { type: 'string', format: 'date' } },
          startPath: '/rooms',
        },
      ],
    },
  });
  node = { origin, manager, handler: createLinkHandler(manager) };

  // Wait for the PHP server.
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(
        `${phpEnv.PSQ_ORIGIN}/.well-known/pagesquire.json`,
      );
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The PHP site did not start.');
});

after(async () => {
  php?.kill();
  await new Promise((resolve) => nodeServer?.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

/** An owner operation on the PHP site, through its command line. */
async function phpOwner(...args) {
  const { stdout } = await run('php', [script, ...args], { env: phpEnv });
  const result = JSON.parse(stdout);
  if (result.error)
    throw Object.assign(new Error(result.error.message), result.error);
  return result;
}

test('a PHP owner invites, a Node owner accepts, both approve, then PHP revokes', async () => {
  const { code } = await phpOwner('invite');
  const accepted = await node.manager.acceptInvitation(code);
  assert.equal(accepted.partner.name, 'Restoran Laut (PHP)');
  assert.equal(accepted.partner.origin, phpEnv.PSQ_ORIGIN);
  const id = accepted.id;

  const nodeApproval = await node.manager.approve(id, {
    offer: { book_table: ['date', 'people'] },
    accept: [],
  });
  assert.equal(nodeApproval.notified, true);
  const phpApproval = await phpOwner(
    'approve',
    id,
    JSON.stringify({ offer: {}, accept: ['book_table'] }),
  );
  assert.equal(phpApproval.notified, true);
  assert.equal(phpApproval.record.status, 'active');
  assert.equal((await node.manager.get(id)).status, 'active');
  assert.deepEqual((await node.manager.get(id)).theirs.accept, ['book_table']);

  // Node hands a visitor to PHP; the PHP site redeems the code once.
  const { url } = await node.manager.handoff(id, {
    skill: 'book_table',
    goal: 'A table for four tonight',
    fields: { date: '2026-10-29', people: 4 },
    returnUrl: `${node.origin}/rooms`,
  });
  assert.ok(url.startsWith(`${phpEnv.PSQ_ORIGIN}/reservations#psq-link=`));
  const handoffCode = url.split('#psq-link=')[1];
  const { ticket } = await phpOwner('redeem', handoffCode);
  assert.match(ticket.returnId, /^ret_[\w-]{22}$/);
  assert.deepEqual(
    { ...ticket, expiresAt: undefined, returnId: undefined },
    {
      kind: 'handoff',
      link: id,
      partner: { origin: node.origin, name: 'Hotel Nusa (Node)' },
      skill: 'book_table',
      goal: 'A table for four tonight',
      fields: { date: '2026-10-29', people: 4 },
      expiresAt: undefined,
      returnId: undefined,
    },
  );
  assert.equal((await phpOwner('redeem', handoffCode)).ticket, null);

  // PHP sends the visitor back to the Node page they left from.
  const back = await phpOwner(
    'sendback',
    id,
    JSON.stringify({
      returnId: ticket.returnId,
      outcome: 'Table for 4 booked for 19:00.',
    }),
  );
  assert.ok(back.url.startsWith(`${node.origin}/rooms#psq-link=`));
  const returned = await node.manager.redeem(back.url.split('#psq-link=')[1]);
  assert.equal(returned.kind, 'return');
  assert.equal(returned.goal, 'Table for 4 booked for 19:00.');
  assert.equal(returned.partner.origin, phpEnv.PSQ_ORIGIN);

  const revoked = await phpOwner('revoke', id);
  assert.equal(revoked.notified, true);
  assert.equal((await node.manager.get(id)).status, 'revoked');
});

test('a Node owner invites and a PHP owner accepts', async () => {
  const { code } = await node.manager.createInvitation();
  const accepted = await phpOwner('accept', code);
  assert.equal(accepted.partner.name, 'Hotel Nusa (Node)');
  assert.equal(accepted.role, 'invitee');
  const inviterSide = await node.manager.get(accepted.id);
  assert.equal(inviterSide.role, 'inviter');
  assert.equal(inviterSide.partner.origin, phpEnv.PSQ_ORIGIN);
  // The invitation is spent: a second acceptance is refused by Node.
  await assert.rejects(phpOwner('accept', code), { code: 'PARTNER_REJECTED' });

  // PHP hands a visitor to Node once both owners approved.
  await phpOwner(
    'approve',
    accepted.id,
    JSON.stringify({ offer: { find_room: ['checkIn'] }, accept: [] }),
  );
  await node.manager.approve(accepted.id, { offer: {}, accept: ['find_room'] });
  const { url } = await phpOwner(
    'handoff',
    accepted.id,
    JSON.stringify({
      skill: 'find_room',
      goal: 'A room from 1 November',
      fields: { checkIn: '2026-11-01' },
      locale: 'en',
    }),
  );
  assert.ok(url.startsWith(`${node.origin}/rooms#psq-link=`));
  const ticket = await node.manager.redeem(url.split('#psq-link=')[1]);
  assert.equal(ticket.partner.origin, phpEnv.PSQ_ORIGIN);
  assert.deepEqual(ticket.fields, { checkIn: '2026-11-01' });
  assert.equal(ticket.locale, 'en');
  await assert.rejects(
    phpOwner(
      'handoff',
      accepted.id,
      JSON.stringify({
        skill: 'find_room',
        goal: 'Room',
        fields: { checkIn: 'soon' },
      }),
    ),
    { code: 'HANDOFF_INVALID' },
  );
});
