// Loads the companion extension into Chromium and serves the generic-tools
// fixture page with data-companion, on origins the development build accepts.
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { test as base, chromium } from '@playwright/test';
import { signActionCall } from '@pagesquire/server';

const root = path.resolve(import.meta.dirname, '../..');
const site = path.join(root, 'examples/plain-html');
export const extensionPath = path.join(root, 'packages/extension');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
};

/** A partner's booking widget, embedded by sites as a cross-origin frame. */
const partnerPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Partner booking</title></head>
<body><main>
  <h1>Partner booking</h1>
  <p id="status">Not booked</p>
  <button id="book" type="button">Book a table</button>
  <label for="note">Booking note</label><input id="note">
  <label><input id="reminder" type="checkbox"> Send reminder</label>
  <p><a href="/terms">Partner terms</a></p>
  <form id="login" onsubmit="return false">
    <label for="partner-user">Partner user</label><input id="partner-user">
    <input id="partner-password" type="password" aria-label="Partner password">
  </form>
</main>
<script>
  document.getElementById('book').addEventListener('click', () => {
    document.getElementById('status').textContent = 'Booked';
  });
</script>
</body></html>`;

/**
 * One site: its well-known declaration is `declaration` (or none), its
 * page embeds `frames` (URLs) as iframes, and its embed tag gets `attributes`.
 */
async function serve(host, declaration, frames = [], attributes = '') {
  const page = (await readFile(path.join(site, 'generic.html'), 'utf8'))
    .replace(
      'data-generic="true"',
      `data-generic="true"\n      data-companion="true" ${attributes}`,
    )
    .replace('data-pages="/generic.html"', 'data-pages="/companion.html"')
    .replace(
      '</main>',
      `${frames
        .map(
          (url, index) =>
            `<iframe title="Partner ${index + 1}" src="${url}" style="display:block;width:600px;height:360px"></iframe>`,
        )
        .join('\n')}</main>`,
    );
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://x').pathname;
    response.setHeader('Cache-Control', 'no-store');
    if (pathname === '/.well-known/pagesquire.json' && declaration) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(declaration));
      return;
    }
    if (pathname === '/partner.html') {
      response.writeHead(200, { 'Content-Type': types['.html'] });
      response.end(partnerPage);
      return;
    }
    if (pathname === '/companion.html') {
      response.writeHead(200, { 'Content-Type': types['.html'] });
      response.end(page);
      return;
    }
    const file = path.resolve(site, `.${pathname}`);
    const type = types[path.extname(file)];
    if (path.relative(site, file).startsWith('..') || !type) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': type });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://${host}:${server.address().port}`;
  return {
    origin,
    url: `${origin}/companion.html`,
    partner: `${origin}/partner.html`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/** The shared synthetic test key; the sites publish its public half. */
export const vector = JSON.parse(
  await readFile(path.join(root, 'tests/fixtures/signing.json'), 'utf8'),
);
export const declaration = {
  version: 1,
  endpoint: '/pagesquire/chat',
  publicKey: vector.publicKey,
  features: ['trustedInput'],
};

/** Signs a call the way the site's server would, for `origin`. */
export const sign = (call, origin, now) =>
  signActionCall(call, { key: vector.signingKey, origin }, now);

export const test = base.extend({
  sites: [
    async ({}, use) => {
      const partner = await serve('localhost');
      const undeclared = await serve('localhost');
      const sites = {
        granted: await serve('127.0.0.1', declaration),
        sameHost: await serve('127.0.0.1', declaration),
        invalid: await serve('localhost', {
          version: 1,
          endpoint: 'https://evil.example/chat',
        }),
        partner,
        undeclared,
        // Declares screenshots and offers ui.screenshot.
        shots: await serve(
          '127.0.0.1',
          { ...declaration, features: ['trustedInput', 'screenshots'] },
          [],
          'data-screenshots="true"',
        ),
        // Declares the partner and a payment provider; embeds the partner
        // and a frame it never declared.
        framed: await serve(
          '127.0.0.1',
          { ...declaration, frames: [partner.origin, 'https://js.stripe.com'] },
          [partner.partner, undeclared.partner],
        ),
      };
      await use(sites);
      for (const entry of Object.values(sites)) entry.close();
    },
    { scope: 'worker' },
  ],
  ctx: async ({}, use) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pagesquire-ext-'));
    const context = await chromium.launchPersistentContext(directory, {
      channel: 'chromium',
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    // Records whether each input the page received was trusted.
    await context.addInitScript(() => {
      window.inputs = [];
      for (const type of ['click', 'input', 'keydown'])
        addEventListener(
          type,
          (event) =>
            window.inputs.push({
              type,
              target: event.target.id || event.target.tagName,
              trusted: event.isTrusted,
              ...(type === 'keydown' ? { key: event.key } : {}),
            }),
          true,
        );
    });
    await use(context);
    await context.close();
    await rm(directory, { recursive: true, force: true });
  },
  sw: async ({ ctx }, use) => {
    await use(
      ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker')),
    );
  },
  page: async ({ ctx, sw }, use) => {
    void sw;
    await use(ctx.pages()[0] ?? (await ctx.newPage()));
  },
});

export { expect } from '@playwright/test';

/** Opens a site page and waits for the embed. */
export async function open(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.PageSquire?.runtime));
}

export const tabIdOf = (sw, url) =>
  sw.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
    url,
  );

/**
 * Whether the extension's own debugger session is attached, and its badge
 * says so. getTargets() cannot tell: Playwright is attached to every tab too.
 */
export const attached = (sw, tabId) =>
  sw.evaluate(async (tabId) => {
    let session = true;
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: '1',
      });
    } catch {
      session = false;
    }
    const badge = (await chrome.action.getBadgeText({ tabId })) === 'ON';
    // The badge follows the session a moment later; report the gap so polls wait.
    return session === badge ? session : 'changing';
  }, tabId);

/** The side panel, opened as a tab that controls `tabId`. */
export async function panel(ctx, sw, tabId) {
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/src/panel.html?tab=${tabId}`);
  return page;
}

/**
 * Runs one generic call; "@Name" values become that target's current id. The
 * call is signed for the page's origin, as the site's server would, unless
 * `signed` is false.
 */
export async function act(page, capabilityId, parameters = {}, signed = true) {
  const call = await page.evaluate(
    ({ capabilityId, parameters }) => {
      const snapshot = window.PageSquire.runtime.observe();
      const targets = [
        ...snapshot.targets,
        ...(snapshot.frames ?? []).flatMap((frame) => frame.targets),
        ...(snapshot.tabs ?? []).flatMap((tab) => tab.targets),
      ];
      const id = (name) =>
        targets.find((target) => target.name === name)?.id ?? 'missing-target';
      return {
        protocolVersion: '0.1',
        callId: crypto.randomUUID(),
        capabilityId,
        snapshotId: snapshot.id,
        parameters: Object.fromEntries(
          Object.entries(parameters).map(([key, value]) => [
            key,
            typeof value === 'string' && value.startsWith('@')
              ? id(value.slice(1))
              : value,
          ]),
        ),
      };
    },
    { capabilityId, parameters },
  );
  return page.evaluate(
    (call) => window.PageSquire.runtime.execute(call),
    signed ? sign(call, new URL(page.url()).origin) : call,
  );
}

/** A signature for a raw input, as if the server had signed that call. */
export function signatureFor(page, capabilityId, parameters, options = {}) {
  return sign(
    {
      protocolVersion: '0.1',
      callId: randomBytes(16).toString('hex'),
      capabilityId,
      snapshotId: 'snapshot-raw',
      parameters: { target: 'target-raw', ...parameters },
    },
    options.origin ?? new URL(page.url()).origin,
    options.now,
  ).signature;
}

/**
 * Talks to the extension the way any script on the page could, skipping the
 * page's own checks, to show the extension enforces its rules by itself.
 */
export function raw(page, args, selector) {
  return page.evaluate(
    async ({ args, selector }) => {
      const channel = new MessageChannel();
      // Pushed frame and tab contents and the relay's wait notice share the
      // port; only answers matter here.
      const next = () =>
        new Promise((resolve) => {
          channel.port1.onmessage = (event) => {
            if (
              ![
                'pagesquire:frames',
                'pagesquire:tabs',
                'pagesquire:hello-wait',
              ].includes(event.data?.type)
            )
              resolve(event.data);
          };
        });
      const hello = next();
      postMessage({ type: 'pagesquire:hello', version: 1 }, location.origin, [
        channel.port2,
      ]);
      const answer = await hello;
      if (answer.type !== 'pagesquire:hello-ack') return answer;
      let nonce = 'f'.repeat(32);
      if (selector) {
        nonce = [...crypto.getRandomValues(new Uint8Array(16))]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        document
          .querySelector(selector)
          .setAttribute('data-pagesquire-target', nonce);
      }
      const reply = next();
      // Frame targets carry no page nonce; the frame resolves them itself.
      channel.port1.postMessage({
        id: 1,
        op: 'act',
        args:
          args.frame || ['switch', 'screenshot'].includes(args.kind)
            ? args
            : { nonce, ...args },
      });
      return reply;
    },
    { args, selector },
  );
}
