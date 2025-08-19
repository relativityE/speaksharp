// playwright.config.ts - Optimized Configuration
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright-tests',

  // Aggressive timeout settings for sandbox environment
  timeout: 60000,        // 60 seconds per test
  expect: {
    timeout: 15000       // 15 seconds for assertions
  },

  // Global setup optimizations
  globalTimeout: 300000, // 5 minutes total

  // Retry and worker settings
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker for stability

  // Reporter
  reporter: 'line',

  use: {
    // Navigation timeout
    navigationTimeout: 45000, // 45 seconds for page loads
    actionTimeout: 15000,     // 15 seconds for actions

    // Video and screenshot only on failure
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',

    // Reduce resource usage
    headless: true,

    // Faster page loads
    ignoreHTTPSErrors: true,

    // Wait strategies
    waitForLoadState: 'domcontentloaded' // Don't wait for all resources
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Optimize for speed
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
          ]
        }
      }
    }
  ],

  // Development server configuration
  webServer: {
    command: 'npm run dev',
    port: 5173,
    timeout: 120000, // 2 minutes for server startup
    reuseExistingServer: !process.env.CI,

    // Wait for server readiness
    env: {
      NODE_ENV: 'test'
    }
  }
});
