const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'model-download-fault.spec.ts',
  timeout: 10_000,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: { headless: true, trace: 'off', screenshot: 'off', video: 'off' },
});
