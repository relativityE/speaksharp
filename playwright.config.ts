import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results',

  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',

  timeout: 30000,
  expect: { timeout: 5000 },
  globalTimeout: 180000,

  workers: 1,
  retries: 0,

  use: {
    baseURL: process.env.WEB_SERVER_URL || 'http://localhost:5173',
    actionTimeout: 15000,
    navigationTimeout: 15000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        headless: true,
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
});
