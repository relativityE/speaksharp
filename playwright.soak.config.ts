import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.development for real Supabase testing
dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

// Use dev server port for real Supabase testing
const PORT = '5173';
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Soak Test Configuration
 * 
 * Purpose: Run long-running concurrent user simulation tests against REAL Supabase
 * Usage: pnpm exec playwright test --config=playwright.soak.config.ts
 * 
 * NOTE: This uses the dev server (port 5173) with real Supabase credentials,
 * not the preview/test server. Make sure dev server is running: pnpm dev
 */
export default defineConfig({
    testDir: './tests/soak',
    outputDir: './test-results/soak',
    timeout: 600_000, // 10-minute timeout for soak tests
    expect: { timeout: 30_000 },
    workers: 1, // Soak tests should run sequentially
    fullyParallel: false,
    retries: 0, // No retries for soak tests - we want accurate timing
    reporter: [['html', { outputFolder: 'test-results/soak-report' }], ['list']],
    use: {
        baseURL: BASE_URL,
        headless: true,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        ignoreHTTPSErrors: true,
        screenshot: 'only-on-failure',
        video: 'off', // No video for soak tests - performance focused
        trace: 'off',
    },
    // NOTE: No webServer block - assumes dev server is already running (pnpm dev)
    // This allows testing against real Supabase backend
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                permissions: ['microphone'],
                launchOptions: {
                    args: [
                        '--use-fake-ui-for-media-stream',
                        '--use-fake-device-for-media-stream',
                    ],
                },
            },
        },
    ],
});
