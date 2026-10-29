// PageSquire Link in the browser (Phase 6B-3): the real embed on two sites,
// hotel.localhost and restaurant resto.localhost (secure contexts), each backed by a real engine and
// LinkManager. The visitor approves on the hotel, the restaurant opens in a
// new tab, and its assistant continues after one click.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  ConversationEngine,
  LinkManager,
  MemoryLinkStore,
  createA2AHandler,
  createLinkHandler,
  createSigningKey,
  siteDeclaration,
} from '@pagesquire/server';

const embed = await readFile(
  new URL('../../packages/embed/dist/pagesquire.min.js', import.meta.url),
  'utf8',
);
const manifest = JSON.parse(
  await readFile(
    new URL('../../packages/embed/dist/manifest.json', import.meta.url),
    'utf8',
  ),
);
const bookTable = {
  id: 'book_table',
  name: 'Book a table',
  description: 'Reserve a table for a date and party size.',
  tags: ['restaurant'],
  fields: {
    date: { type: 'string', format: 'date' },
    people: { type: 'integer', minimum: 1, maximum: 20 },
  },
  startPath: '/reservations',
};

/** Two paired, approved sites; `sent` lists the link messages between them. */
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
  const hotel = add('http://hotel.localhost', 'Hotel Nusa', []);
  const resto = add('http://resto.localhost', 'Restoran Laut', [bookTable]);
  const { id } = await hotel.acceptInvitation(
    (await resto.createInvitation()).code,
  );
  await hotel.approve(id, {
    offer: { book_table: ['date', 'people'] },
    accept: [],
  });
  await resto.approve(id, { offer: {}, accept: ['book_table'] });
  return { hotel, resto, sent, add };
}

function scripted(...drafts) {
  const calls = [];
  return {
    calls,
    async complete(messages) {
      calls.push(messages);
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

/** Serves one site: its page with the embed, and its chat route backed by the engine. */
async function serve(context, origin, path, title, engine) {
  const states = new Map();
  await context.route(`${origin}/**`, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === '/pagesquire.min.js')
      return route.fulfill({ contentType: 'text/javascript', body: embed });
    if (pathname === '/chat') {
      const body = request.postDataJSON();
      try {
        const { state, reply } = await engine.handle(
          body,
          body.conversationId ? states.get(body.conversationId) : null,
          ['link.handoff', 'link.return'],
        );
        states.set(state.id, state);
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(reply),
        });
      } catch (error) {
        return route.fulfill({
          status: error.status ?? 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: error.code, message: error.message },
          }),
        });
      }
    }
    if (pathname === path)
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1></main><script src="/pagesquire.min.js" data-endpoint="/chat" data-csrf-token="token-1234567890" data-title="${title}" data-link="true"></script></body></html>`,
      });
    return route.fulfill({ status: 404, body: 'Not found' });
  });
}

const handoffDraft = {
  text: 'Restoran Laut can book that.',
  emotion: 'happy',
  finished: false,
  toolCalls: [
    {
      capabilityId: 'link.handoff',
      parameters: {
        skill: 'resto.localhost/book_table',
        goal: 'A table for four on 29 October',
        fields: { date: '2026-10-29', people: 4 },
      },
    },
  ],
};

async function ask(page, message) {
  await page.waitForFunction(() => Boolean(window.PageSquire?.client));
  await page.getByLabel('How can I help with this page?').fill(message);
  await page.getByRole('button', { name: 'Send' }).click();
}

test('the visitor approves a handoff and the partner continues after one click', async ({
  page,
  context,
}) => {
  const { hotel, resto, sent } = await sites();
  const hotelProvider = scripted(
    handoffDraft,
    said('Restoran Laut is open in a new tab.'),
  );
  const restoProvider = scripted(
    said('Welcome! Shall I book a table for 4 people on 29 October?'),
  );
  await serve(
    context,
    'http://hotel.localhost',
    '/',
    'Hotel Nusa',
    new ConversationEngine({ provider: hotelProvider, manifest, links: hotel }),
  );
  await serve(
    context,
    'http://resto.localhost',
    '/reservations',
    'Restoran Laut',
    new ConversationEngine({
      provider: restoProvider,
      manifest: { schemaVersion: '0.1', capabilities: [] },
      links: resto,
    }),
  );

  await page.goto('http://hotel.localhost/');
  await ask(page, 'Book a table for 4 on 2026-10-29');
  const consent = page.getByRole('alertdialog', {
    name: 'Continue on Restoran Laut?',
  });
  await expect(consent).toContainText('A table for four on 29 October');
  await expect(consent).toContainText('date2026-10-29');
  await expect(consent).toContainText('people4');
  await expect(consent).toContainText(
    'http://resto.localhost opens in a new tab.',
  );
  // Nothing went to the partner before the visitor chose.
  expect(sent.filter((type) => type === 'handoff')).toEqual([]);

  const opened = context.waitForEvent('page');
  await consent
    .getByRole('button', { name: 'Continue on Restoran Laut' })
    .click();
  const partner = await opened;
  await partner.waitForURL('http://resto.localhost/reservations');
  // The code left the address bar as soon as the partner page loaded.
  expect(partner.url()).not.toContain('psq-link');
  expect(sent.filter((type) => type === 'handoff')).toEqual(['handoff']);
  await expect(
    page.locator('.pagesquire-message.pagesquire-assistant').last(),
  ).toHaveText('Restoran Laut is open in a new tab.');

  const banner = partner.getByRole('region', {
    name: 'Continue from a partner site',
  });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Continue' }).click();
  await expect(banner).toBeHidden();
  await expect(
    partner.locator('.pagesquire-message.pagesquire-assistant').last(),
  ).toHaveText('Welcome! Shall I book a table for 4 people on 29 October?');
  const first = restoProvider.calls[0];
  expect(first.at(-2).content).toBe(
    'Continued from Hotel Nusa (hotel.localhost): A table for four on 29 October',
  );
  expect(JSON.parse(first.at(-1).content).untrustedHandoff).toEqual({
    partner: { origin: 'http://hotel.localhost', name: 'Hotel Nusa' },
    skill: 'book_table',
    fields: { date: '2026-10-29', people: 4 },
  });

  // A code that was never issued, or was already redeemed, starts nothing.
  const again = await context.newPage();
  await again.goto(
    `http://resto.localhost/reservations#psq-link=${'A'.repeat(22)}`,
  );
  await again
    .getByRole('region', { name: 'Continue from a partner site' })
    .getByRole('button', { name: 'Continue' })
    .click();
  await expect(
    again.locator('.pagesquire-message.pagesquire-assistant').last(),
  ).toContainText('expired or was already used');
  expect(restoProvider.calls).toHaveLength(1);
});

test('cancelling the consent sends nothing to the partner', async ({
  page,
  context,
}) => {
  const { hotel, sent } = await sites();
  await serve(
    context,
    'http://hotel.localhost',
    '/',
    'Hotel Nusa',
    new ConversationEngine({
      provider: scripted(handoffDraft),
      manifest,
      links: hotel,
    }),
  );
  await page.goto('http://hotel.localhost/');
  await ask(page, 'Book a table for 4 on 2026-10-29');
  const consent = page.getByRole('alertdialog', {
    name: 'Continue on Restoran Laut?',
  });
  await consent.getByRole('button', { name: 'Cancel' }).click();
  await expect(
    page.locator('.pagesquire-message.pagesquire-action'),
  ).toHaveText('link.handoff: cancelled');
  expect(context.pages()).toHaveLength(1);
  expect(sent.filter((type) => type === 'handoff')).toEqual([]);
});

test('the partner sends the visitor back to the hotel with the outcome', async ({
  page,
  context,
}) => {
  const { hotel, resto, sent } = await sites();
  const outcome = 'Table for 4 booked for 29 October, 19:00.';
  const hotelProvider = scripted(
    handoffDraft,
    said('Restoran Laut is open in a new tab.'),
    said('Welcome back! Your table for 4 is booked.'),
  );
  const restoProvider = scripted(
    {
      text: 'Booked. Taking you back to the hotel.',
      emotion: 'happy',
      finished: false,
      toolCalls: [{ capabilityId: 'link.return', parameters: { outcome } }],
    },
    said('Enjoy your stay.'),
  );
  await serve(
    context,
    'http://hotel.localhost',
    '/',
    'Hotel Nusa',
    new ConversationEngine({ provider: hotelProvider, manifest, links: hotel }),
  );
  await serve(
    context,
    'http://resto.localhost',
    '/reservations',
    'Restoran Laut',
    new ConversationEngine({ provider: restoProvider, manifest, links: resto }),
  );

  await page.goto('http://hotel.localhost/');
  await ask(page, 'Book a table for 4 on 2026-10-29');
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Continue on Restoran Laut' }).click();
  const partner = await opened;
  await partner.waitForURL('http://resto.localhost/reservations');
  await partner
    .getByRole('region', { name: 'Continue from a partner site' })
    .getByRole('button', { name: 'Continue' })
    .click();

  // The restaurant offers to go back; the visitor sees the outcome first.
  const consent = partner.getByRole('alertdialog', {
    name: 'Back to Hotel Nusa?',
  });
  await expect(consent).toContainText(outcome);
  await expect(consent).toContainText(
    'http://hotel.localhost opens in a new tab.',
  );
  const home = context.waitForEvent('page');
  await consent.getByRole('button', { name: 'Back to Hotel Nusa' }).click();
  const back = await home;
  await back.waitForURL('http://hotel.localhost/');
  expect(sent.filter((type) => type === 'return')).toEqual(['return']);
  await expect(
    partner.locator('.pagesquire-message.pagesquire-assistant').last(),
  ).toHaveText('Enjoy your stay.');

  await back
    .getByRole('region', { name: 'Continue from a partner site' })
    .getByRole('button', { name: 'Continue' })
    .click();
  await expect(
    back.locator('.pagesquire-message.pagesquire-assistant').last(),
  ).toHaveText('Welcome back! Your table for 4 is booked.');
  expect(hotelProvider.calls[2].at(-2).content).toBe(
    `Back from Restoran Laut (resto.localhost): ${outcome}`,
  );
  expect((await hotel.get((await hotel.list())[0].id)).stats).toEqual({
    sent: 1,
    received: 1,
    skills: { book_table: { sent: 1, received: 0 } },
    lastAt: expect.any(Number),
  });
});

test('with two restaurants offering the skill, the visitor chooses one', async ({
  page,
  context,
}) => {
  const { hotel, resto, sent, add } = await sites();
  const warung = add('http://warung.localhost', 'Warung Sari', [
    {
      ...bookTable,
      fields: { people: bookTable.fields.people },
      startPath: '/booking',
    },
  ]);
  const { id } = await hotel.acceptInvitation(
    (await warung.createInvitation()).code,
  );
  await hotel.approve(id, { offer: { book_table: ['people'] }, accept: [] });
  await warung.approve(id, { offer: {}, accept: ['book_table'] });
  const warungProvider = scripted(said('Warung Sari here. A table for 4?'));
  await serve(
    context,
    'http://hotel.localhost',
    '/',
    'Hotel Nusa',
    new ConversationEngine({
      provider: scripted(handoffDraft, said('Warung Sari is open.')),
      manifest,
      links: hotel,
    }),
  );
  await serve(
    context,
    'http://warung.localhost',
    '/booking',
    'Warung Sari',
    new ConversationEngine({
      provider: warungProvider,
      manifest: { schemaVersion: '0.1', capabilities: [] },
      links: warung,
    }),
  );

  await page.goto('http://hotel.localhost/');
  await ask(page, 'Book a table for 4 on 2026-10-29');
  const consent = page.getByRole('alertdialog', {
    name: 'Where do you want to continue?',
  });
  await expect(consent).toContainText('A table for four on 29 October');
  const laut = consent.getByRole('group', {
    name: 'Restoran Laut (http://resto.localhost)',
  });
  await expect(laut).toContainText('date2026-10-29');
  const sari = consent.getByRole('group', {
    name: 'Warung Sari (http://warung.localhost)',
  });
  await expect(sari).toContainText('people4');
  await expect(sari).not.toContainText('date');
  await expect(consent).toContainText(
    'The site you choose opens in a new tab.',
  );

  const opened = context.waitForEvent('page');
  await sari.getByRole('button', { name: 'Continue on Warung Sari' }).click();
  const partner = await opened;
  await partner.waitForURL('http://warung.localhost/booking');
  expect(sent.filter((type) => type === 'handoff')).toEqual(['handoff']);
  await partner
    .getByRole('region', { name: 'Continue from a partner site' })
    .getByRole('button', { name: 'Continue' })
    .click();
  await expect(
    partner.locator('.pagesquire-message.pagesquire-assistant').last(),
  ).toHaveText('Warung Sari here. A table for 4?');
  expect(
    JSON.parse(warungProvider.calls[0].at(-1).content).untrustedHandoff,
  ).toEqual({
    partner: { origin: 'http://hotel.localhost', name: 'Hotel Nusa' },
    skill: 'book_table',
    fields: { people: 4 },
  });
  // The restaurant the visitor did not choose received nothing.
  expect((await resto.list())[0].stats).toBeUndefined();
});

test("a visitor opens an AI agent's link and the assistant continues after one click", async ({
  page,
  context,
}) => {
  const resto = new LinkManager({
    store: new MemoryLinkStore(),
    signingKey: createSigningKey().signingKey,
    origin: 'http://resto.localhost',
    profile: {
      endpoint: '/pagesquire/link',
      name: 'Restoran Laut',
      skills: [bookTable],
    },
    a2a: { endpoint: '/a2a', skills: ['book_table'] },
  });
  const answer = await (
    await createA2AHandler(resto)(
      new Request('http://resto.localhost/a2a', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'A2A-Version': '1.0' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'SendMessage',
          params: {
            message: {
              messageId: 'm-1',
              role: 'ROLE_USER',
              parts: [
                {
                  data: {
                    skill: 'book_table',
                    goal: 'A table for four on 29 October',
                    fields: { date: '2026-10-29', people: 4 },
                  },
                },
              ],
            },
          },
        }),
      }),
    )
  ).json();
  const url = answer.result.message.parts[1].data.url;
  const provider = scripted(said('Shall I book 4 people on 29 October?'));
  await serve(
    context,
    'http://resto.localhost',
    '/reservations',
    'Restoran Laut',
    new ConversationEngine({
      provider,
      manifest: { schemaVersion: '0.1', capabilities: [] },
      links: resto,
    }),
  );
  await page.goto(url);
  await page.waitForURL('http://resto.localhost/reservations');
  const banner = page.getByRole('region', {
    name: 'Continue a request from an AI agent',
  });
  await expect(banner).toContainText('An AI agent sent you here');
  await banner.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.locator('.pagesquire-message.pagesquire-assistant').last(),
  ).toHaveText('Shall I book 4 people on 29 October?');
  expect(provider.calls[0].at(-2).content).toBe(
    'Request from an AI agent: A table for four on 29 October',
  );
  expect(JSON.parse(provider.calls[0].at(-1).content).untrustedHandoff).toEqual(
    {
      from: 'an AI agent (A2A)',
      skill: 'book_table',
      fields: { date: '2026-10-29', people: 4 },
    },
  );
});
