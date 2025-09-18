import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load environment variables for tests
dotenv.config({ path: '.env.test' });

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.WEB_SERVER_URL || 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',
  projects: [
    { name: 'setup', testMatch: /test\.setup\.ts/ },
    {
      name: 'chromium-pro',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'storage/pro.json',
      },
      testMatch: /pro\.e2e\.spec\.ts/,
    },
    {
      name: 'chromium-premium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'storage/premium.json',
      },
      testMatch: /pro\.e2e\.spec\.ts/,
    },
    {
      name: 'chromium-free',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'storage/free.json',
      },
      testMatch: /free\.e2e\.spec\.ts/,
    },
    {
      name: 'chromium-anon',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
      testMatch: /anon\.e2e\.spec\.ts/,
    },
    {
      name: 'chromium-basic',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
      testMatch: /basic\.e2e\.spec\.ts/,
    },
  ],
});
