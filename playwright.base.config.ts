import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { PORTS } from './scripts/build.config.js';

/**
 * Playwright Base Configuration
 * 
 * This provides shared defaults for all Playwright test configurations.
 * Specialized configs (e2e, stripe, demo, soak) extend this base.
 * 
 * Usage: Import and merge with defineConfig in specialized configs.
 */

// Environment paths
const envPaths = {
    test: path.resolve(process.cwd(), '.env.test'),
    development: path.resolve(process.cwd(), '.env.development'),
};

// Server URLs (using centralized port config)
export const urls = {
    dev: `http://localhost:${PORTS.DEV}`,
    preview: `http://localhost:${PORTS.PREVIEW}`,
};

/**
 * Load environment variables from specified env file
 */
export function loadEnv(envFile: 'test' | 'development') {
    dotenv.config({ path: envPaths[envFile] });
}

/**
 * Get Chrome device config with microphone permissions
 */
export function getChromeWithMic() {
    return {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
            args: [
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
            ],
        },
    };
}

/**
 * Get Chrome device config for memory profiling (soak tests)
 */
export function getChromeWithMemoryProfiling() {
    return {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
            args: [
                '--enable-precise-memory-info',
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
            ],
        },
    };
}

/**
 * Get basic Chrome device config (no special permissions)
 */
export function getChromeBasic() {
    return {
        ...devices['Desktop Chrome'],
    };
}

/**
 * Base configuration options shared across all test types
 */
export const baseConfig: Partial<PlaywrightTestConfig> = {
    workers: 1,
    fullyParallel: false,
    use: {
        headless: true,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        ignoreHTTPSErrors: true,
        screenshot: 'only-on-failure',
        trace: 'on-first-retry',
    },
};
