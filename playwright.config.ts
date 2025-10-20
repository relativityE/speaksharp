import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.test
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

const PORT = process.env.VITE_PORT || '5173';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000, // 2-minute global timeout for each test file
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/playwright-report.json' }],
  ],
  globalSetup: './tests/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm exec dotenv -e .env.test -- pnpm exec vite --mode test',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120 * 1000, // 2 minutes
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      VITE_TEST_MODE: 'true',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Add this to capture console logs
  onPage: page => {
    page.on('console', msg => console.log('[BROWSER CONSOLE]', msg.text()));
    page.on('pageerror', err => console.error('[BROWSER ERROR]', err));
  },
});
