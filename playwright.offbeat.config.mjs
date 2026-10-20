import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/offbeat',
  outputDir: './test-results/offbeat',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4180', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/serve-offbeat.mjs --synthetic-backend',
    url: 'http://127.0.0.1:4180',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
