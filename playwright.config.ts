import { defineConfig } from '@playwright/test';
import { loadEnv, getChromeWithMic, baseConfig, urls } from './playwright.base.config';

/**
 * Main E2E Test Configuration
 * 
 * Purpose: Run E2E tests with mocked auth (MSW)
 * Usage: pnpm test:e2e
 */

// Load test environment variables
loadEnv('test');

const BASE_URL = urls.dev;

export default defineConfig({
  ...baseConfig,
  testDir: './tests/e2e',
  testIgnore: '**/canary/**',
  outputDir: './test-results/playwright',
  timeout: 300_000, // 5-minute global timeout for unmocked Whisper
  expect: { timeout: 120_000 }, // 2-minute expect timeout
  retries: 1,
  reporter: process.env.CI
    ? [['blob'], ['github']]
    : [['html'], ['json', { outputFile: 'test-results/playwright/results.json' }]],
  use: {
    ...baseConfig.use,
    baseURL: BASE_URL,
    video: 'retain-on-failure',
  },
  updateSnapshots: process.env.CI ? 'missing' : 'none',
  webServer: {
    command: 'pnpm dev --force',
    url: BASE_URL,
    reuseExistingServer: process.env.CI === 'true', // CRITICAL: Always restart locally to prevent stale code (Zombie Server)
    timeout: 120 * 1000,
    env: {
      DOTENV_CONFIG_PATH: '.env.test',
      VITE_MODE: 'test', // Ensure frontend loads test env vars if needed
    },
  },
  projects: [
    {
      name: 'chromium',
      snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
      use: getChromeWithMic(),
    },
    // Soak tests run separately via: npx playwright test --config=playwright.soak.config.ts
  ],
});
