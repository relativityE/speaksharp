import { defineConfig } from '@playwright/test';
import { loadEnv, getChromeBasic, baseConfig, urls } from './playwright.base.config';

/**
 * Stripe Checkout Test Configuration
 * 
 * Purpose: Run Stripe checkout flow tests against REAL Supabase + Stripe
 * Usage: pnpm exec playwright test --config=playwright.stripe.config.ts
 * 
 * NOTE: Uses dev server (matching PORTS.DEV) with real Supabase credentials.
 * Assumes dev server is already running: pnpm dev
 */

// Load development environment for real Supabase
loadEnv('development');

export default defineConfig({
    ...baseConfig,
    testDir: './tests/stripe',
    outputDir: './test-results/stripe',
    timeout: 60_000, // 1-minute timeout
    expect: { timeout: 15_000 },
    retries: 0,
    reporter: [['html', { outputFolder: 'test-results/stripe-report' }], ['list']],
    use: {
        ...baseConfig.use,
        baseURL: urls.dev,
        video: 'off',
    },
    // No webServer - assumes dev server is running
    projects: [
        {
            name: 'chromium',
            use: getChromeBasic(),
        },
    ],
});
