// playwright.config.ts - VM Optimized
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // VM-friendly settings
  timeout: 15000, // Shorter timeout for VM resources
  expect: { timeout: 5000 },

  // Single worker to avoid resource contention in VM
  workers: 1,

  // Don't retry in VM to save time/resources
  retries: 0,

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    timeout: 30000, // Shorter timeout for AI agent
    reuseExistingServer: false, // Always fresh start - no cleanup needed

    // AI agent environment
    env: {
      NODE_ENV: 'test',
      CI: 'true', // Signal this is automated testing
    }
  },

  // AI agent specific: fail fast, no hanging
  globalTimeout: 120000, // 2 minute max for entire test suite

  use: {
    baseURL: 'http://localhost:5173',
    // Faster settings for VM
    actionTimeout: 10000,
    navigationTimeout: 10000,
  },

  // Minimal browser setup for VM
  projects: [
    {
      name: 'chromium',
      use: {
        headless: true, // Always headless in VM
        viewport: { width: 1280, height: 720 },
        // Disable some features to save VM resources
        video: 'off',
        screenshot: 'only-on-failure',
      },
    },
  ],

  // Minimal reporting for VM
  reporter: [
    ['list'],
    ['html', { open: 'never' }]
  ],
});
