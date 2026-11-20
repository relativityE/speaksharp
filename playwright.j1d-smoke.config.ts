import { defineConfig, devices } from '@playwright/test';

/**
 * J1.d reserved-namespace smoke against a DISPOSABLE local Supabase stack (scripts/j1d-smoke/stack.sh). Headless Chromium on
 * loopback only; no trace, video or screenshot (the pages hold a synthetic address), and no web server here: the stack script
 * builds and serves the app. With J1D_SMOKE_EVIDENCE=1 (the j1d-smoke CI job) the run also writes its raw SDK blob and the smoke
 * producer receipt (scripts/j1d-smoke/smoke-playwright-reporter.mjs), which refuses outside that job's exact CI lineage.
 */
const evidence = process.env.J1D_SMOKE_EVIDENCE === '1';
export default defineConfig({
    testDir: './tests/smoke',
    testMatch: /\.smoke\.spec\.ts$/,
    timeout: 420_000,
    retries: 0,
    workers: 1,
    reporter: evidence
        ? [['blob', { outputDir: 'blob-report' }], ['./scripts/j1d-smoke/smoke-playwright-reporter.mjs'], ['list']]
        : [['list']],
    projects: [{ name: 'j1d-smoke', use: { ...devices['Desktop Chrome'], headless: true, trace: 'off', video: 'off', screenshot: 'off' } }],
});
