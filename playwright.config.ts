import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './playwright-tests',
  timeout: 60000,
  expect: {
    timeout: 15000
  },
  globalTimeout: 300000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'line',
  use: {
    viewport: { width: 1280, height: 720 },
    navigationTimeout: 45000,
    actionTimeout: 15000,
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: true,
    ignoreHTTPSErrors: true,
    waitForLoadState: 'domcontentloaded'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream'
          ]
        },
        permissions: ['microphone']
      }
    }
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'test',
      VITE_SUPABASE_URL: "https://test.supabase.co",
      VITE_SUPABASE_ANON_KEY: "test_anon_key"
    }
  }
});
