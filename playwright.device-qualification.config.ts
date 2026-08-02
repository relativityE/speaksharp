import { defineConfig, devices } from '@playwright/test';
import { loadEnv } from './playwright.base.config';
import { DEVICE_BROWSERS, DEVICE_VIEWPORTS } from './tests/release/deviceQualificationContract';

loadEnv('test');

const BASE_URL = `http://${process.env.E2E_HOST || '127.0.0.1'}:${process.env.E2E_PORT || '4173'}`;
const selectedBrowser = process.env.DEVICE_BROWSER;
const browserDevice = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};

const projects = DEVICE_BROWSERS
  .filter(browser => !selectedBrowser || browser === selectedBrowser)
  .flatMap(browser => DEVICE_VIEWPORTS.map(viewport => ({
    name: `${browser}-${viewport.key}`,
    use: {
      ...browserDevice[browser],
      viewport: { width: viewport.width, height: viewport.height },
      storageState: undefined,
    },
    metadata: {
      browser,
      viewportKey: viewport.key,
      orientation: viewport.orientation,
    },
  })));

if (projects.length === 0) {
  throw new Error(`DEVICE_BROWSER must be one of ${DEVICE_BROWSERS.join(', ')}`);
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'device-qualification-foundation.e2e.spec.ts',
  outputDir: './test-results/device-qualification',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['line']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'allow',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'pnpm serve:e2e',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects,
  tsconfig: './tsconfig.json',
});
