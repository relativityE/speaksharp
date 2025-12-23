import { defineConfig } from '@playwright/test';
import { loadEnv, getChromeWithMic, baseConfig, urls } from './playwright.base.config';
import { SOAK_CONFIG } from './tests/constants';

/**
 * Soak Test Configuration
 * 
 * Purpose: Run long-running concurrent user simulation tests
 * Usage: pnpm exec playwright test --config=playwright.soak.config.ts
 * 
 * NOTE: Uses dev server (matching PORTS.DEV) with real Supabase credentials.
 * Assumes dev server is already running: pnpm dev
 */

// Load development environment for real Supabase
loadEnv('development');

export default defineConfig({
    ...baseConfig,
    testDir: './tests/soak',
    outputDir: './test-results/soak',
    timeout: SOAK_CONFIG.PLAYWRIGHT_TIMEOUT_MS,
    expect: { timeout: 30_000 },
    retries: 0, // No retries - we want accurate timing
    reporter: [['html', { outputFolder: 'test-results/soak-report' }], ['list']],
    use: {
        ...baseConfig.use,
        baseURL: urls.dev,
        video: 'off', // No video - performance focused
        trace: 'off',
    },
    // No webServer - assumes dev server is running
    projects: [
        {
            name: 'chromium',
            use: getChromeWithMic(),
        },
    ],
});
