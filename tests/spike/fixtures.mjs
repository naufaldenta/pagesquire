import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, chromium } from '@playwright/test';
import { startSites } from './pages.mjs';

export const extensionPath = path.join(import.meta.dirname, 'extension');
const results = path.resolve(import.meta.dirname, '../../test-results/spike');

/** Chromium (not Chrome) still accepts --load-extension; new headless runs it. */
export function launch(userDataDir, options = {}) {
  return chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
    ...options,
  });
}

export async function record(name, data) {
  await mkdir(results, { recursive: true });
  await appendFile(
    path.join(results, 'measurements.jsonl'),
    `${JSON.stringify({ name, at: new Date().toISOString(), ...data })}\n`,
  );
  console.log(`[spike] ${name} ${JSON.stringify(data)}`);
}

export const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    Math.round(
      sorted[
        Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
      ] * 10,
    ) / 10
  );
};

export const test = base.extend({
  sites: [
    async ({}, use) => {
      const sites = await startSites();
      await use(sites);
      sites.close();
    },
    { scope: 'worker' },
  ],
  spikeLaunch: [{}, { option: true }],
  ctx: async ({ spikeLaunch }, use) => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'pagesquire-spike-'),
    );
    const context = await launch(directory, spikeLaunch);
    await use(context);
    await context.close();
    await rm(directory, { recursive: true, force: true });
  },
  sw: async ({ ctx }, use) => {
    await use(
      ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker')),
    );
  },
  tab: async ({ ctx, sw, sites }, use) => {
    void sw;
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(sites.urls.main);
    await page.waitForFunction(() => document.querySelector('#react-button'));
    await use(page);
  },
});

export { expect } from '@playwright/test';
