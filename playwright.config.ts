import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 30000,
  expect: { timeout: 5000 },
  globalTimeout: 180000,

  workers: 1,
  retries: 0,

  use: {
    baseURL: 'http://localhost:5173',
    actionTimeout: 15000,
    navigationTimeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        headless: true,
        viewport: { width: 1280, height: 720 },
        video: 'off',
        screenshot: 'only-on-failure',
      },
    },
  ],

  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
});
