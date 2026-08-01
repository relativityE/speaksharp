import { defineConfig } from '@playwright/test';
import * as os from 'os';
import { loadEnv, getChromeWithMic, baseConfig } from './playwright.base.config';
import { CI_CONFIG } from './scripts/ci.config.js';

/**
 * Main E2E Test Configuration
 * 
 * Purpose: Run E2E tests with mocked auth (MSW)
 * Usage: pnpm test:e2e
 */

// Load test environment variables
loadEnv('test');
const TIMEOUT_MULTIPLIER = parseInt(process.env.CI_TIMEOUT_MULTIPLIER ?? '1');
const BASE_URL = `http://${process.env.E2E_HOST || '127.0.0.1'}:${process.env.E2E_PORT || '4173'}`;

export default defineConfig({
  ...baseConfig,
  testDir: './tests/e2e',
  // Exclude other categories. The v4 browser-control proof is additionally excluded unless explicitly
  // requested, so the normal suite reports no permanently "skipped" tests; it runs only via the
  // dispatch-only .github/workflows/v4-browser-proof.yml, which sets RUN_V4_BROWSER_PROOF=1.
  testIgnore: [
    /.*\.(live|canary|soak)\.spec\.ts/,
    ...(process.env.RUN_V4_BROWSER_PROOF === '1' ? [] : [/v4-posthog-browser-control\.e2e\.spec\.ts/]),
  ],
  outputDir: './test-results/playwright',
  // FAIL FAST: Aggressive timeouts - no test should hang
  timeout: 60_000 * TIMEOUT_MULTIPLIER, // 60s per test max (bridged to diagnostic guard)
  expect: { timeout: 15_000 * TIMEOUT_MULTIPLIER }, // 15s expect timeout
  retries: 1,
  workers: process.env.CI
    ? Math.min(Math.max(1, Math.floor(os.cpus().length * CI_CONFIG.WORKER_SCALING_RATIO)), CI_CONFIG.MAX_WORKERS)
    : undefined,
  reporter: [['line'], ['./scripts/playwright-telemetry-reporter.mjs']],
  use: {
    ...baseConfig.use,
    baseURL: BASE_URL,
    // ✅ CRITICAL: Disable all browser caching
    launchOptions: {
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
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
    viewport: { width: 1280, height: 900 },

    // ✅ Allow service workers for MSW
    serviceWorkers: 'allow',

    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  updateSnapshots: process.env.CI ? 'missing' : 'none',
  // ✅ CRITICAL: Web server configuration
  webServer: {
    // ✅ Use Custom E2E Server for production-like environment
    command: 'pnpm serve:e2e',
    port: 4173,

    // ✅ CRITICAL: Reuse server in dev (faster), restart in CI (fresh)
    reuseExistingServer: true,

    // ✅ Wait for server to be ready
    timeout: 120000,

    // ✅ Log server output
    stdout: 'pipe',
    stderr: 'pipe',
  },

  projects: [
    {
      name: 'infra-probe',
      testMatch: '**/infra.probe.e2e.spec.ts',
      snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
      use: {
        ...getChromeWithMic(),
        launchOptions: {
          args: [
            ...(getChromeWithMic().launchOptions?.args || []),
            '--disable-cache',
            '--disable-blink-features=AutomationControlled',
          ]
        },
        storageState: undefined,
      },
    },
    {
      name: 'full-suite',
      testMatch: ['tests/e2e/**/*.spec.ts'],
      // NOTE: project-level testIgnore OVERRIDES the root-level one in Playwright (it does not merge),
      // so the v4 exclusion MUST be repeated here. A root-only exclusion is silently ineffective —
      // verified: root-only still collected all 3 v4 tests.
      testIgnore: [
        '**/infra.probe.e2e.spec.ts',
        '**/dump-ground/**',
        '**/*.live.spec.ts',
        ...(process.env.RUN_V4_BROWSER_PROOF === '1' ? [] : ['**/v4-posthog-browser-control.e2e.spec.ts']),
      ],
      dependencies: ['infra-probe'],
      snapshotPathTemplate: '{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}{ext}',
      use: {
        ...getChromeWithMic(),
        launchOptions: {
          args: [
            ...(getChromeWithMic().launchOptions?.args || []),
            '--disable-cache',
            '--disable-blink-features=AutomationControlled',
          ]
        },
        storageState: undefined,
      },
    },
    // Soak tests run separately via: npx playwright test --config=playwright.soak.config.ts
  ],
  // ✅ Resolve aliases from tsconfig (e.g., @shared)
  tsconfig: './tsconfig.json',
});
