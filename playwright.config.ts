import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use a solution-style tsconfig.json in `tests/`
const TSCONFIG_PATH = path.join(__dirname, 'tests', 'tsconfig.json');

export default defineConfig({
  testDir: './tests/e2e',
  // Re-enable the original analytics page test
  testMatch: /analytics-page\.e2e\.spec\.ts/,

  webServer: {
    command: 'pnpm exec vite --mode test',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
