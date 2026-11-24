import { defineConfig } from '@playwright/test';

// J1.f / J7.d on the disposable billing local stack only (billing-local-stack-journey, journey `account_deletion`).
// Deliberately separate from live/default collection. No dotenv, production defaults or auto-started app.
export default defineConfig({
  testDir: './tests/billing/user-journey', testMatch: 'account-deletion.billing.spec.ts',
  timeout: 420_000, expect: { timeout: 30_000 }, workers: 1, retries: 0,
  fullyParallel: false, maxFailures: 0,
  reporter: [['list']], outputDir: 'test-results/account-deletion',
  use: { browserName: 'chromium', baseURL: process.env.BILLING_SANDBOX_APP_URL, trace: 'off', video: 'off', screenshot: 'off' },
});
