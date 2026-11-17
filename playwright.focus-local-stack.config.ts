import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// #1882 Focus switch with real saves, on a disposable local stack only (focus-local-stack-repro.yml). Separate from the
// live, deployed-live and e2e collections: no dotenv, no production defaults, no auto-started app, no retries.
// Washington is 65.8 s of unique speech, so a 12 s take never hears the fixture loop.
export default defineConfig({
  testDir: './tests/live', testMatch: 'focus-switch-real-saves-1882.localstack.spec.ts',
  timeout: 1_800_000, expect: { timeout: 30_000 }, workers: 1, retries: 0,
  fullyParallel: false, maxFailures: 0,
  reporter: [['list']], outputDir: 'test-results/focus-local-stack-1882',
  use: {
    browserName: 'chromium', baseURL: process.env.FOCUS_LOCAL_APP_URL,
    trace: 'off', video: 'off', screenshot: 'off',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${fileURLToPath(new URL('./tests/fixtures/stt-isomorphic/audio/washington_01.wav', import.meta.url))}`] },
  },
});
