import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Deliberately separate from live/default collection. No dotenv, production defaults or auto-started app.
export default defineConfig({
  testDir: './tests/billing/user-journey', testMatch: 'journey.billing.spec.ts',
  timeout: 600_000, expect: { timeout: 30_000 }, workers: 1, retries: 0,
  fullyParallel: false, maxFailures: 0,
  reporter: [['list']], outputDir: 'test-results/billing-user-journey',
  use: {
    browserName: 'chromium', baseURL: process.env.BILLING_SANDBOX_APP_URL,
    trace: 'off', video: 'off', screenshot: 'off',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${fileURLToPath(new URL('./tests/fixtures/harvard_benchmark_16k.wav', import.meta.url))}`] },
  },
});
