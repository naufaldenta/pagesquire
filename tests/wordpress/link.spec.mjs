// PageSquire Link on WordPress: the owner pairs the fixture site with a real
// Node partner from the dashboard, both sides approve, then the owner revokes.
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import {
  LinkManager,
  MemoryLinkStore,
  createLinkHandler,
  createSigningKey,
  siteDeclaration,
} from '@pagesquire/server';

const origin = 'http://127.0.0.1:4177';
const linkRoute = `${origin}/?rest_route=/pagesquire/v1/link`;
const findRoom = {
  id: 'find_room',
  name: 'Find a room',
  description: 'Show rooms for some dates.',
  tags: ['hotel'],
  fields: { checkIn: { type: 'string', format: 'date' } },
  startPath: '/rooms',
};

async function partnerSite() {
  const key = createSigningKey().signingKey;
  const site = {};
  const server = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const response = incoming.url.startsWith('/.well-known/pagesquire.json')
      ? new Response(
          JSON.stringify(
            siteDeclaration({
              endpoint: '/pagesquire/chat',
              signingKey: key,
              link: site.manager.declaration(),
            }),
          ),
        )
      : await site.handler(
          new Request(`${site.origin}${incoming.url}`, {
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
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  site.server = server;
  site.origin = `http://127.0.0.1:${server.address().port}`;
  site.manager = new LinkManager({
    store: new MemoryLinkStore(),
    signingKey: key,
    origin: site.origin,
    profile: {
      endpoint: '/pagesquire/link',
      name: 'Restoran Node',
      skills: [
        {
          id: 'book_table',
          name: 'Book a table',
          description: 'Reserve a table.',
          tags: ['restaurant'],
          fields: { people: { type: 'integer', minimum: 1, maximum: 20 } },
          startPath: '/reservations',
        },
      ],
    },
  });
  site.handler = createLinkHandler(site.manager);
  return site;
}

async function login(page) {
  await page.goto(`${origin}/wp-login.php`, { timeout: 30000 });
  await page.locator('#user_login').fill('fixture-admin');
  await page.locator('#user_pass').fill('pagesquire-fixture-password');
  await page.locator('#wp-submit').click();
  await page.waitForURL(/wp-admin/, { timeout: 30000 });
}

test('an owner pairs WordPress with a Node partner, approves and revokes', async ({
  page,
  request,
}) => {
  const partner = await partnerSite();
  const status = page.locator('#pagesquire-admin-status');
  try {
    await login(page);
    await page.goto(`${origin}/wp-admin/admin.php?page=pagesquire`);
    // Off by default: no declaration (plain permalinks answer with the home
    // page) and no partner endpoint.
    expect(
      (await request.get(`${origin}/.well-known/pagesquire.json`)).headers()[
        'content-type'
      ],
    ).not.toContain('application/json');
    expect((await request.post(linkRoute, { data: {} })).status()).toBe(404);

    await page.getByLabel('Enable PageSquire Link').check();
    await page
      .getByLabel('Site name shown to partners')
      .fill('Hotel WordPress');
    await page
      .getByLabel('Skills partners may hand visitors into (JSON)')
      .fill(JSON.stringify([findRoom]));
    await page.getByRole('button', { name: 'Save Link settings' }).click();
    await expect(status).toContainText('PageSquire Link enabled.');

    const declaration = await (
      await request.get(`${origin}/.well-known/pagesquire.json`)
    ).json();
    expect(Object.keys(declaration).sort()).toEqual([
      'endpoint',
      'features',
      'link',
      'publicKey',
      'version',
    ]);
    expect(declaration.features).toEqual(['trustedInput', 'link']);
    expect(declaration.link).toMatchObject({
      endpoint: '/index.php?rest_route=/pagesquire/v1/link',
      name: 'Hotel WordPress',
      skills: [findRoom],
    });

    // The partner endpoint answers malformed messages with JSON errors.
    const junk = await request.post(linkRoute, {
      headers: { 'Content-Type': 'application/json' },
      data: { claims: 1 },
    });
    expect(junk.status()).toBe(400);
    expect((await junk.json()).error.code).toBe('LINK_INVALID');
    expect(
      (
        await request.post(linkRoute, {
          headers: { 'Content-Type': 'text/plain' },
          data: '{}',
        })
      ).status(),
    ).toBe(415);

    await page.getByRole('button', { name: 'Create invitation' }).click();
    await expect(status).toContainText('Invitation created.');
    const code = await page.getByLabel('New invitation').inputValue();
    expect(code).toMatch(/^psq1\./);

    // The Node owner accepts; WordPress verifies the partner's key from its own origin.
    const link = await partner.manager.acceptInvitation(code);
    expect(link.partner).toMatchObject({
      origin,
      name: 'Hotel WordPress',
      skills: [findRoom],
    });
    await expect(partner.manager.acceptInvitation(code)).rejects.toThrow();

    await page.reload();
    const card = page.getByRole('region', {
      name: `Restoran Node (${partner.origin})`,
    });
    await expect(card).toContainText('Status: pending');
    await card.getByLabel('Book a table', { exact: true }).check();
    await card.getByLabel('Book a table: people').check();
    await card.getByLabel('Find a room').check();
    await card.getByRole('button', { name: 'Approve Restoran Node' }).click();
    await expect(status).toContainText('Approved. Status: pending.');
    expect((await partner.manager.get(link.id)).theirs.accept).toEqual([
      'find_room',
    ]);

    const approved = await partner.manager.approve(link.id, {
      offer: { find_room: ['checkIn'] },
      accept: ['book_table'],
    });
    expect(approved.notified).toBe(true);
    expect(approved.record.status).toBe('active');
    await page.reload();
    await expect(card).toContainText(
      'Status: active. They accept: book_table.',
    );

    page.once('dialog', (dialog) => void dialog.accept());
    await card.getByRole('button', { name: 'Revoke Restoran Node' }).click();
    await expect(status).toContainText('Link revoked.');
    await expect(card).toContainText('Status: revoked');
    expect((await partner.manager.get(link.id)).status).toBe('revoked');

    // An invalid code is refused without contacting anyone. (WordPress
    // accepting a partner's invitation is covered by the PHP and cross-stack
    // tests: the single-threaded fixture server cannot answer the partner's
    // callback while it is still handling the owner's request.)
    await page.getByLabel('Invitation from a partner').fill('psq1.nonsense');
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(status).toContainText('not a valid invitation');
  } finally {
    await page.getByLabel('Enable PageSquire Link').uncheck();
    await page.getByRole('button', { name: 'Save Link settings' }).click();
    await expect(status).toContainText('Link is off.');
    partner.server.close();
  }
});
