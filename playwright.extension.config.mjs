import { defineConfig } from '@playwright/test';

// The companion extension needs a persistent Chromium context per test, so
// these tests run apart from the main browser suite.
export default defineConfig({
  outputDir: './test-results/extension',
  testDir: './tests/extension',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Each test drives a full Chromium with CDP. Two run side by side locally;
  // small CI runners keep one, so parallel browsers do not starve each other.
  workers: process.env.CI ? 1 : 2,
  reporter: 'list',
  // Multi-tab CDP flows take a while, more so on a busy machine.
  timeout: 60000,
  use: { trace: 'retain-on-failure' },
});
