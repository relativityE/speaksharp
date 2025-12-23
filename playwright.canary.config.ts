import { defineConfig } from '@playwright/test';
import { loadEnv, getChromeWithMic, baseConfig } from './playwright.base.config';

/**
 * Canary Test Configuration
 * 
 * Purpose: Run smoke tests against REAL staging infrastructure
 * Usage: pnpm test:canary (after starting dev server)
 * 
 * Modeled after playwright.soak.config.ts for proven real-auth pattern.
 * 
 * Requirements:
 *   - .env.development with real VITE_SUPABASE_URL/KEY
 *   - CANARY_PASSWORD env var (from GitHub secret)
 *   - VITE_USE_LIVE_DB=true and VITE_TEST_MODE=true
 */

// Load REAL Supabase credentials from .env.development
loadEnv('development');

export default defineConfig({
    ...baseConfig,
    testDir: './tests/e2e',
    testMatch: 'smoke.canary.spec.ts',
    outputDir: './test-results/canary',
    timeout: 60000,
    retries: 1,
    reporter: [['html', { outputFolder: 'playwright-report' }], ['list']],
    use: {
        ...baseConfig.use,
        baseURL: 'http://localhost:5173',  // Dev server port (not preview)
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
    },
    // No webServer - workflow starts server via start-server-and-test (like soak)
    projects: [{ name: 'chromium', use: getChromeWithMic() }],
});
