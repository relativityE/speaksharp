var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'path';
// Load environment variables from .env.test
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });
var PORT = process.env.VITE_PORT || '5173';
var BASE_URL = "http://localhost:".concat(PORT);
export default defineConfig({
    testDir: './tests/e2e',
    timeout: 300000,
    expect: { timeout: 10000 },
    // Set workers to 1 to prevent parallel execution during stabilization
    workers: 1,
    fullyParallel: false,
    retries: 1,
    reporter: [
        ['list'],
        ['json', { outputFile: 'test-results/playwright-report.json' }],
    ],
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
    webServer: {
        command: 'pnpm exec dotenv -e .env.test -- pnpm exec vite --mode test',
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 120 * 1000,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            VITE_TEST_MODE: 'true',
        },
    },
    projects: [
        {
            name: 'chromium',
            use: __assign({}, devices['Desktop Chrome']),
        },
    ],
});
