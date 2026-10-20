import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  scanProject,
  saveScan,
  writeReport,
  prepareAi,
  validateProject,
  scanDom,
} from '@pagesquire/cli';
import { temporaryProject, registerFixture } from '../fixtures/onboarding.mjs';

test('manual and AI-handoff onboarding compile working browser capabilities under strict CSP', async ({
  page,
}) => {
  const cleanup = [];
  const project = await temporaryProject(
    { after: (action) => cleanup.push(action) },
    'http://127.0.0.1:4173/',
  );
  try {
    await project.put(
      'index.html',
      '<h1 id="title">Synthetic page</h1><button id="heading-color">Heading control</button>',
    );
    await saveScan(project.files, await scanProject(project.files));
    await writeReport(project.files);
    const handoff = await prepareAi(project.files, 'both');
    expect(handoff.externalAiContacted).toBe(false);
    const adapter = await readFile(
      'tests/fixtures/onboarding-adapter.mjs',
      'utf8',
    );
    const capabilities = await registerFixture(project, 3, adapter);
    expect((await validateProject(project.files, true)).compiled).toBe(true);
    const parameters = await project.files.read(
      'pagesquire/generated/parameters.js',
      2_000_000,
    );
    const bindings = await project.files.read(
      'pagesquire/generated/bindings.mjs',
    );
    await page.route('**/__onboarding/**', async (route) => {
      const name = new URL(route.request().url()).pathname;
      const content = name.endsWith('/parameters.js')
        ? parameters
        : name.endsWith('/bindings.mjs')
          ? bindings
          : adapter;
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: content,
      });
    });
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.pagesquireDemo));
    const bodyColor = await page
      .locator('#body-copy')
      .evaluate((el) => getComputedStyle(el).color);
    const results = await page.evaluate(
      async (manifest) => {
        const { parameters } =
          await import('/__onboarding/generated/parameters.js');
        const { handlers, verifiers } =
          await import('/__onboarding/generated/bindings.mjs');
        const demo = window.pagesquireDemo;
        const registry = new demo.registry.constructor(manifest, {
          parameters,
          handlers,
          verifiers,
        });
        const runtime = new demo.runtime.constructor({
          observer: demo.observer,
          registry,
        });
        const results = [];
        for (const [capabilityId, args] of [
          ['accessibility.set_heading_color', { color: '#ff0000' }],
          ['accessibility.set_link_highlight', { enabled: true }],
          ['accessibility.set_font_weight', { weight: 700 }],
        ]) {
          results.push(
            await runtime.execute({
              protocolVersion: '0.1',
              callId: crypto.randomUUID(),
              capabilityId,
              parameters: args,
              snapshotId: runtime.observe().id,
            }),
          );
        }
        return results;
      },
      { schemaVersion: '0.1', capabilities },
    );
    expect(results.map((result) => result.status)).toEqual([
      'success',
      'success',
      'success',
    ]);
    await expect(page.locator('main h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
    await expect(page.locator('#body-copy')).toHaveCSS('color', bodyColor);
    await expect(page.locator('main')).toHaveClass('links-highlighted');
    await expect(page.locator('body')).toHaveCSS('font-weight', '700');
  } finally {
    for (const action of cleanup) await action();
  }
});

test('DOM discovery excludes private content, detects ambiguity, blocks POST/fetch/foreign resources and does not click', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<h1>Do not export page text</h1><button id="duplicate" onclick="fetch(\'/clicked\')">Do not export label</button><button id="duplicate">Repeated</button><section data-pagesquire-private><button id="private">Private</button></section><input type="password" value="private-input"><input id="search" value="never-export"><script>fetch("/mutate",{method:"POST"}).catch(()=>{});fetch("/read-data").catch(()=>{});fetch("https://external.invalid/track").catch(()=>{});new WebSocket("ws://127.0.0.1:"+location.port+"/socket");</script>',
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const cleanup = [];
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const project = await temporaryProject(
      { after: (action) => cleanup.push(action) },
      url,
    );
    const [result] = await scanDom(project.files, [url]);
    expect(result.status).toBe('observed');
    expect(
      result.controls
        .filter((control) => control.selectorHint === '#duplicate')
        .every((control) => control.matches === 2),
    ).toBe(true);
    expect(
      result.controls.some((control) => control.selectorHint === '#search'),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /private-input|never-export|Do not export|#private/,
    );
    expect(result.blockedRequests).toBeGreaterThanOrEqual(4);
    expect(requests).toEqual([{ method: 'GET', url: '/' }]);
    const scan = await scanProject(project.files);
    scan.dom = [result];
    await saveScan(project.files, scan);
    const report = await writeReport(project.files);
    expect(report.ambiguousHints).toBe(2);
    expect(report.runtimeVerified).toBe(false);
  } finally {
    for (const action of cleanup) await action();
    await new Promise((resolve) => server.close(resolve));
  }
});
