import { defineConfig } from '@playwright/test';

// Phase 4D-0 spike only. Run with:
//   npx playwright test --config tests/spike/playwright.config.mjs
// SPIKE_HEADED=1 adds the headed debugging-bar check.
export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results/spike',
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 60000,
});
