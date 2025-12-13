import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.development for real Supabase testing
dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

// Use dev server port for real Supabase testing
const PORT = '5173';
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Stripe Checkout Test Configuration
 * 
 * Purpose: Run Stripe checkout flow tests against REAL Supabase + Stripe
 * Usage: pnpm exec playwright test --config=playwright.stripe.config.ts
 * 
 * NOTE: This uses the dev server (port 5173) with real Supabase credentials,
 * not the preview/test server. Make sure dev server is running: pnpm dev
 */
export default defineConfig({
    testDir: './tests/stripe',
    outputDir: './test-results/stripe',
    timeout: 60_000, // 1-minute timeout for stripe tests
    expect: { timeout: 15_000 },
    workers: 1, // Run sequentially
    fullyParallel: false,
    retries: 0,
    reporter: [['html', { outputFolder: 'test-results/stripe-report' }], ['list']],
    use: {
        baseURL: BASE_URL,
        headless: true,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        ignoreHTTPSErrors: true,
        screenshot: 'only-on-failure',
        video: 'off',
        trace: 'on-first-retry',
    },
    // NOTE: No webServer block - assumes dev server is already running (pnpm dev)
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
            },
        },
    ],
});
