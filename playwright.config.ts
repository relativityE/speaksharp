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
  testIgnore: ['**/canary/**', '**/*.live.spec.ts'],
  outputDir: './test-results/playwright',
  // FAIL FAST: Aggressive timeouts - no test should hang
  timeout: 30_000, // 30s per test max
  expect: { timeout: 10_000 }, // 10s expect timeout
  retries: 1,
  reporter: process.env.CI
    ? [['blob'], ['github']]
    : [['html'], ['json', { outputFile: 'test-results/playwright/results.json' }]],
  use: {
    ...baseConfig.use,
    baseURL: BASE_URL,
    video: 'retain-on-failure',
    // FAIL FAST: Action timeout (click, fill, etc.)
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  updateSnapshots: process.env.CI ? 'missing' : 'none',
  webServer: {
    command: 'pnpm dev --force',
    url: BASE_URL,
    reuseExistingServer: true, // CRITICAL: Always restart locally to prevent stale code (Zombie Server)
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
