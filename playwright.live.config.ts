import { defineConfig, devices } from '@playwright/test';
import { loadEnv, baseConfig, urls } from './playwright.base.config';

/**
 * Live E2E Test Configuration
 * 
 * Purpose: Run E2E tests against REAL services (Supabase, Stripe, AssemblyAI)
 * Usage: pnpm test:e2e:live
 */

// Load development environment for real Supabase keys
loadEnv('development');

const BASE_URL = urls.dev;

// CRITICAL: Set env vars for the TEST RUNNER process (not just the webServer)
process.env.EDGE_FN_URL = 'https://yxlapjuovrsvjswkwnrk.supabase.co/functions/v1';
process.env.AGENT_SECRET = 'mock_agent_secret';
process.env.E2E_FREE_EMAIL = 'test-user@example.com';
process.env.E2E_FREE_PASSWORD = 'password123';
process.env.E2E_PRO_EMAIL = 'test-user@example.com';
process.env.E2E_PRO_PASSWORD = 'password123';
process.env.REAL_WHISPER_TEST = 'true';
process.env.VITE_USE_LIVE_DB = 'true';

export default defineConfig({
    ...baseConfig,
    testDir: './tests/e2e',
    // Explicitly match .live.spec.ts files
    testMatch: '**/*.live.spec.ts',
    // Clear the ignore list so these aren't skipped
    testIgnore: [],
    outputDir: './test-results/playwright-live',
    timeout: 60_000, // Longer timeout for live services
    reporter: [['list'], ['html', { outputFolder: 'test-results/live-report' }]],
    use: {
        ...baseConfig.use,
        baseURL: BASE_URL,
        video: 'on-first-retry',
    },
    webServer: {
        command: 'pnpm dev --force',
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 120 * 1000,
        env: {
            DOTENV_CONFIG_PATH: '.env.development',
            // Ensure we use the live DB flags
            VITE_USE_LIVE_DB: 'true',
            REAL_WHISPER_TEST: 'true',
            // Credentials & Secrets for Live Tests
            // Credentials & Secrets for Live Tests
            EDGE_FN_URL: 'https://yxlapjuovrsvjswkwnrk.supabase.co/functions/v1/create-user', // From .env.development based on URL
            AGENT_SECRET: 'mock_agent_secret', // Live tests usually mock the agent invocation or need a real secret
            E2E_FREE_EMAIL: 'test-user@example.com',
            E2E_FREE_PASSWORD: 'password123',
            E2E_PRO_EMAIL: 'test-user@example.com',
            E2E_PRO_PASSWORD: 'password123',
            // Use the static user for visual analytics test
            VISUAL_TEST_EMAIL: 'test-user@example.com',
            VISUAL_TEST_PASSWORD: 'password123',
            VISUAL_TEST_USER_TYPE: 'pro',
            VISUAL_TEST_BASE_URL: BASE_URL,
        },
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
