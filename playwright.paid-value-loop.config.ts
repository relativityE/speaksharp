import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Outcome 8 (PAID-01) paid value loop. Separate from live/default collection and from the three billing journeys:
// no dotenv, production defaults or auto-started app. Washington is 65.8 s of unique speech, so a 45 s eligible take
// never hears the fixture loop (see tests/live/helpers/audio-fixtures.ts).
export default defineConfig({
  testDir: './tests/billing/user-journey', testMatch: 'paid-value-loop.billing.spec.ts',
  timeout: 2_400_000, expect: { timeout: 30_000 }, workers: 1, retries: 0,
  fullyParallel: false, maxFailures: 0,
  reporter: [['list']], outputDir: 'test-results/billing-paid-value-loop',
  use: {
    browserName: 'chromium', baseURL: process.env.BILLING_SANDBOX_APP_URL,
    trace: 'off', video: 'off', screenshot: 'off',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${fileURLToPath(new URL('./tests/fixtures/stt-isomorphic/audio/washington_01.wav', import.meta.url))}`] },
  },
});
