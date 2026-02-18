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
  timeout: 30_000, // 30s per test max
  expect: { timeout: 10_000 }, // 10s expect timeout
  retries: 1,
  reporter: process.env.CI
    ? [['blob'], ['github']]
    : [['html'], ['json', { outputFile: 'test-results/playwright/results.json' }]],
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

    // ✅ No service workers
    serviceWorkers: 'block',

    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  updateSnapshots: process.env.CI ? 'missing' : 'none',
  // ✅ CRITICAL: Web server configuration
  // ✅ Use Dev Server for E2E (No build artifacts, faster HMR, fresh code)
  command: 'pnpm run dev --port 5173',

  port: 5173,

  // ✅ CRITICAL: Never reuse existing server
  reuseExistingServer: false,

  // ✅ Wait for server to be ready
  timeout: 120000,

  // ✅ Log server output
  stdout: 'pipe',
  stderr: 'pipe',
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
