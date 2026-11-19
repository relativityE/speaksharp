import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Cutover rehearsal B only: a disposable local stack and two locally built apps. No dotenv, no production
// defaults, no auto-started app, no provider and no Stripe. Synthetic fake-microphone audio only.
export default defineConfig({
  testDir: './tests/release/cutover', testMatch: 'old-tab-recovery.rehearsal.spec.ts',
  timeout: 900_000, expect: { timeout: 30_000 }, workers: 1, retries: 0,
  fullyParallel: false, maxFailures: 0,
  reporter: [['list']], outputDir: 'test-results/cutover-rehearsal',
  use: {
    browserName: 'chromium',
    trace: 'off', video: 'off', screenshot: 'off',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${fileURLToPath(new URL('./tests/fixtures/harvard_benchmark_16k.wav', import.meta.url))}`] },
  },
});
