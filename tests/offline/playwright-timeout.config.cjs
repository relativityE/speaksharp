const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'rwt-timeout-cleanup.spec.cjs',
  timeout: 80,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
