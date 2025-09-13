import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  testDir: './tests',
  timeout: 30_000, // Changed from 60_000
  expect: {
    timeout: 10_000,
  },
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'test-results/e2e-report' }]],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },

  globalSetup: resolve(__dirname, './tests/global-setup.ts'),
  globalTeardown: resolve(__dirname, './tests/global-teardown.ts'),

  // Optional: run tests in parallel
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
