// Phase 4D-0 spike: does an attached chrome.debugger session keep the MV3
// service worker alive past its 30-second idle limit? Playwright attaches
// DevTools to service workers, which keeps them alive by itself, so this
// launches Chromium directly with no automation protocol at all.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { expect, extensionPath, record, test } from './fixtures.mjs';

const idleMs = Number(process.env.SPIKE_IDLE_MS ?? 45000);

async function probe(sites, mode) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pagesquire-life-'));
  const browser = spawn(
    chromium.executablePath(),
    [
      '--headless',
      // Playwright also launches without the OS sandbox by default.
      '--no-sandbox',
      `--user-data-dir=${directory}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      `${sites.urls.main}?lifetime=${mode}&idle=${idleMs}`,
    ],
    { stdio: 'ignore' },
  );
  try {
    await expect
      .poll(() => sites.reports.find((r) => r.mode === mode), {
        timeout: idleMs + 30000,
        intervals: [1000],
      })
      .toBeTruthy();
    return sites.reports.find((r) => r.mode === mode);
  } finally {
    browser.kill();
    await new Promise((resolve) => browser.once('exit', resolve));
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

test('an attached debugger keeps the service worker alive', async ({
  sites,
}) => {
  test.setTimeout(idleMs * 2 + 60000);
  const [control, attached] = await Promise.all([
    probe(sites, 'control'),
    probe(sites, 'attached'),
  ]);
  await record('lifetime', { control, attached });
  // The control proves the method: an idle, detached worker is stopped.
  expect(control.restarted).toBe(true);
  expect(attached.restarted).toBe(false);
  expect(attached.attachedTabs).toHaveLength(1);
});
