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
import { loadEnv, getChromeWithMic, baseConfig } from './playwright.base.config';

loadEnv('test');

// 10sec.wav: long enough to outlast WASM engine init (~20s) when combined with the
// data-state='recording' engine-ready gate in private-stt.live.spec.ts.
const LIVE_AUDIO_FIXTURE = 'tests/fixtures/10sec.wav';

export default defineConfig({
    ...baseConfig,

    // Only pick up .live.spec.ts files — no crossover with mock E2E suite
    testDir: './tests',
    testMatch: /.*\.live\.spec\.ts/,

    outputDir: './test-results/live',

    // Live tests involve real WASM model loading (can be slow on first cold run)
    timeout: 90_000,
    expect: { timeout: 20_000 },

    // No retries — flaky live tests should be investigated, not re-run silently
    retries: 0,

    reporter: process.env.CI
        ? [['blob', { outputDir: 'blob-report/live' }], ['github']]
        : [['html', { outputFile: 'test-results/live/report.html' }], ['list']],

    use: {
        ...baseConfig.use,
        baseURL: 'http://localhost:5173',

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
                    args: [
                        // Audio injection: feed .wav file into the fake capture device
                        '--use-fake-device-for-media-stream',
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
        command: 'pnpm run dev --port 5173',
        port: 5173,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
    },
});
