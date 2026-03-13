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

const BASE_URL = 'http://localhost:5173'; // switched to dev server

export default defineConfig({
  ...baseConfig,
  testDir: './tests/e2e',
  testIgnore: [/.*\.(live|canary|soak)\.spec\.ts/], // Exclude other categories
  outputDir: './test-results/playwright',
  // FAIL FAST: Aggressive timeouts - no test should hang
  timeout: 60_000, // 60s per test max (bridged to diagnostic guard)
  expect: { timeout: 15_000 }, // 15s expect timeout
  retries: 1,
  workers: process.env.CI ? '50%' : undefined,
  reporter: [['line'], ['./scripts/playwright-telemetry-reporter.mjs']],
  use: {
    ...baseConfig.use,
    baseURL: BASE_URL,
    // ✅ CRITICAL: Disable all browser caching
    launchOptions: {
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-cache',           // ← Disable disk cache
        '--disable-application-cache', // ← Disable app cache
        '--disable-offline-load-stale-cache',
        '--disk-cache-size=0',       // ← Zero cache size
        '--media-cache-size=0'
      ],
    },

    // ✅ Use incognito context (no persistent state)
    contextOptions: {
      ignoreHTTPSErrors: true,
    },

    // ✅ Force fresh context for each test
    viewport: { width: 1280, height: 720 },

    // ✅ Allow service workers for MSW
    serviceWorkers: 'allow',

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  updateSnapshots: process.env.CI ? 'missing' : 'none',
  /*
  // ✅ CRITICAL: Web server configuration
  webServer: {
    // ✅ Use Dev Server for E2E in TEST mode (loads .env.test)
    command: 'pnpm dev',

    port: 5173,

    // ✅ CRITICAL: Reuse server in dev (faster), restart in CI (fresh)
    reuseExistingServer: true,

    // ✅ Wait for server to be ready
    timeout: 120000,

    // ✅ Log server output
    stdout: 'pipe',
    stderr: 'pipe',
  },
  */
  projects: [
    {
      name: 'chromium',
      snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
      use: getChromeWithMic(),
    },
    // Soak tests run separately via: npx playwright test --config=playwright.soak.config.ts
  ],
});
