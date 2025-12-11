import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables for test mode
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

// Use the preview server for test builds
const PORT = '4173';
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Demo Recording Configuration
 * 
 * Purpose: Record product demo videos showcasing all features
 * Usage: pnpm exec playwright test --config=playwright.demo.config.ts
 * 
 * This config uses:
 * - MSW mocked auth (like E2E tests) for consistent demo experience
 * - Video recording enabled
 * - Higher resolution for quality recordings
 */
export default defineConfig({
    testDir: './tests/demo',
    outputDir: './test-results/demo',
    timeout: 300_000, // 5-minute timeout for demos
    expect: { timeout: 30_000 },
    workers: 1,
    fullyParallel: false,
    retries: 0,
    reporter: [['html', { outputFolder: 'test-results/demo-report' }], ['list']],
    use: {
        baseURL: BASE_URL,
        headless: true,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        ignoreHTTPSErrors: true,
        screenshot: 'on',
        video: 'on', // Always record video for demos
        trace: 'on-first-retry',
    },
    webServer: {
        command: 'pnpm preview',
        port: 4173,
        reuseExistingServer: true,
        timeout: 60_000,
    },
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
