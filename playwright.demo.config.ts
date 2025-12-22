import { defineConfig } from '@playwright/test';
import { loadEnv, getChromeWithMic, baseConfig, urls } from './playwright.base.config';
import { PORTS } from './scripts/build.config.js';

/**
 * Demo Recording Configuration
 * 
 * Purpose: Record product demo videos showcasing all features
 * Usage: pnpm exec playwright test --config=playwright.demo.config.ts
 * 
 * Uses MSW mocked auth for consistent demo experience.
 * Video recording enabled with high resolution.
 */

// Load test environment for mocked auth
loadEnv('test');

export default defineConfig({
    ...baseConfig,
    testDir: './tests/demo',
    outputDir: './test-results/demo',
    timeout: 300_000, // 5-minute timeout for demos
    expect: { timeout: 30_000 },
    retries: 0,
    reporter: [['html', { outputFolder: 'test-results/demo-report' }], ['list']],
    use: {
        ...baseConfig.use,
        baseURL: urls.preview,
        screenshot: 'on',
        video: 'on', // Always record video for demos
    },
    webServer: {
        command: 'pnpm preview',
        port: PORTS.PREVIEW,
        reuseExistingServer: true,
        timeout: 60_000,
    },
    projects: [
        {
            name: 'chromium',
            use: getChromeWithMic(),
        },
    ],
});
