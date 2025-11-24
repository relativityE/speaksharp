import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.test
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

const PORT = process.env.VITE_PORT || '4173';
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/playwright',
  timeout: 120_000, // 2-minute global timeout for each test file
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 1,
  reporter: process.env.CI ? [['blob'], ['github']] : [['html'], ['json', { outputFile: 'test-results/playwright/results.json' }]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: "pnpm preview:test",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes
    env: {
      DOTENV_CONFIG_PATH: ".env.test",
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'soak',
      testDir: './tests/soak',
      timeout: 10 * 60 * 1000, // 10 minutes per test
      retries: 0, // No retries for soak tests
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        // Enable precise memory reporting for Chrome
        launchOptions: {
          args: [
            '--enable-precise-memory-info',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      },
    },
  ],
});
