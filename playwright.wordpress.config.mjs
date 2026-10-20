import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  outputDir: './test-results/wordpress',
  testDir: './tests/wordpress',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 180000,
  expect: { timeout: 15000 },
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4177', trace: 'retain-on-failure' },
  projects: [
    { name: 'wordpress-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node scripts/serve-wordpress.mjs',
    url: 'http://127.0.0.1:4177/wp-login.php',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
