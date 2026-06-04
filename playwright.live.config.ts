/**
 * @file playwright.live.config.ts
 * @description Playwright configuration for LIVE integration tests.
 *
 * PURPOSE:
 *   Separate from playwright.config.ts (mock E2E) to avoid test isolation leakage.
 *   Live tests require real WASM model loading and hardware-level audio injection.
 *   These are expensive and gated — run on schedule or via PR label in CI.
 *
 * AUDIO INJECTION:
 *   Chromium is launched with:
 *     --use-fake-device-for-media-stream   → bypasses real mic; uses fake capture device
 *     --use-file-for-fake-audio-capture    → feeds a real .wav file into that fake device
 *
 * CROSS-ORIGIN ISOLATION:
 *   WASM with SharedArrayBuffer requires COOP/COEP headers.
 *   The dev server must serve these headers, or tests will self-skip via:
 *     if (!window.crossOriginIsolated) test.skip()
 *
 * USAGE:
 *   pnpm exec playwright test --config=playwright.live.config.ts
 *   or via CI: gh workflow run with label 'test:live'
 */
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { loadEnv, getChromeWithMic, baseConfig } from './playwright.base.config';

loadEnv('test');
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
const liveViteMode = process.env.LIVE_VITE_MODE || 'development';
process.env.VITE_USE_LIVE_DB = process.env.VITE_USE_LIVE_DB || 'true';
process.env.VITE_SKIP_MSW = process.env.VITE_SKIP_MSW || 'true';
process.env.VITE_TEST_MODE = process.env.VITE_TEST_MODE || 'false';
// Live proofs exercise the runtime app against real auth/profile state. loadEnv('test')
// may inherit mock-auth defaults from .env.test, so force the live harness back onto
// the real-auth path before Vite starts.
process.env.VITE_USE_MOCK_AUTH = 'false';
process.env.VITE_AUTH_MODE = 'real';

// Use a checked-in PCM WAV fixture with known ground truth. Do not point live
// STT validation at external downloads or local machine paths.
const LIVE_AUDIO_FIXTURE = process.env.LIVE_AUDIO_FIXTURE
    ? path.resolve(process.env.LIVE_AUDIO_FIXTURE)
    : fileURLToPath(new URL('./tests/fixtures/harvard_benchmark_16k.wav', import.meta.url));

export default defineConfig({
    ...baseConfig,

    // Only pick up .live.spec.ts files — no crossover with mock E2E suite
    testDir: './tests',
    testMatch: /.*\.live\.spec\.ts/,

    outputDir: './test-results/live',

    // Live tests involve real WASM model loading (can be slow on first cold run)
    timeout: 300_000,
    expect: { timeout: 20_000 },

    // No retries — flaky live tests should be investigated, not re-run silently
    retries: 0,
    workers: 1,
    fullyParallel: false,

    reporter: process.env.CI
        ? [['blob', { outputDir: 'blob-report/live' }], ['github']]
        : [['html', { outputFile: 'test-results/live/report.html' }], ['list']],

    use: {
        ...baseConfig.use,
        baseURL: process.env.BASE_URL || 'http://localhost:5173',

        // Trace always on for live tests — failures are hard to reproduce
        trace: 'on',
        screenshot: 'on',
        video: 'on',
    },

    projects: [
        {
            name: 'live-stt-chromium',
            use: {
                ...getChromeWithMic(),
                launchOptions: {
                    ...getChromeWithMic().launchOptions,
                    args: [
                        ...(getChromeWithMic().launchOptions?.args ?? []),
                        // Audio injection: feed .wav file into the fake capture device
                        `--use-file-for-fake-audio-capture=${LIVE_AUDIO_FIXTURE}`,

                        // Disable automation detection (can block getUserMedia)
                        '--disable-blink-features=AutomationControlled',

                        // Cache isolation — prevent stale WASM model cache from prior runs
                        '--disable-cache',
                        '--disable-application-cache',
                        '--disk-cache-size=0',
                        '--media-cache-size=0',
                    ],
                },
            },
        },
    ],

    webServer: {
        command: `cd frontend && pnpm vite --port 5173 --mode ${liveViteMode} --logLevel error`,
        port: 5173,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
