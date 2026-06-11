import { defineConfig } from '@playwright/test';
import { loadEnv, getChromeWithMemoryProfiling, baseConfig, urls } from './playwright.base.config';
import { SOAK_CONFIG } from './tests/constants';

/**
 * Soak Test Configuration
 * 
 * Purpose: Run long-running concurrent user simulation tests
 * Usage: pnpm exec playwright test --config=playwright.soak.config.ts
 * 
 * NOTE: Uses the mocked E2E server mode with live Supabase credentials injected
 * by the workflow when VITE_USE_LIVE_DB=true.
 */

// Load development environment for real Supabase (dynamically managed in Cloud)
loadEnv('development');

export default defineConfig({
    ...baseConfig,
    testDir: './tests/soak',
    testMatch: '**/*.spec.ts',
    outputDir: './test-results/soak',
    timeout: SOAK_CONFIG.PLAYWRIGHT_TIMEOUT_MS,
    expect: { timeout: 30_000 },
    retries: 0, // No retries - we want accurate timing
    reporter: [['html', { outputFolder: 'test-results/soak-report' }], ['list']],
    use: {
        ...baseConfig.use,
        baseURL: urls.dev,
        video: 'off',
        trace: 'retain-on-failure',
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
    },
    webServer: process.env.CI ? {
        command: 'pnpm dev:test',
        url: urls.dev,
        reuseExistingServer: false,
        timeout: 120 * 1000,
        env: {
            VITE_AUTH_MODE: 'real',
            VITE_USE_MOCK_AUTH: 'false',
            VITE_TEST_MODE: 'true',
            VITE_USE_LIVE_DB: 'true',
        },
    } : undefined,
    projects: [
        {
            name: 'chromium',
            use: getChromeWithMemoryProfiling(),
        },
    ],
});
