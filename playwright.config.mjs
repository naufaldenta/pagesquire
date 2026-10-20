import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  outputDir: './test-results/browser',
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : 3,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node examples/node-chat/server.mjs',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: false,
      timeout: 15000,
    },
    {
      command: 'npm --prefix examples/nextjs run dev',
      url: 'http://127.0.0.1:4176',
      reuseExistingServer: false,
      timeout: 90000,
    },
    {
      command: 'node scripts/serve-demo.mjs',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 15000,
    },
    {
      command: 'php -S 127.0.0.1:4174 examples/php-chat/router.php',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      timeout: 15000,
    },
  ],
});
