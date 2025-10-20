// tests/e2e/health-check.e2e.spec.ts
import { test, expect } from './helpers';

test.describe('Health Check', () => {
  test('should load the homepage successfully and capture console logs', async ({ page }) => {
    // 1. Set up a listener for all console messages
    page.on('console', msg => {
      console.log(`Browser Console [${msg.type()}]: ${msg.text()}`);
    });

    // 2. Navigate to the page and see if any errors are thrown
    await page.goto('/');

    // 3. The original assertion, which is expected to fail but will run after the console listener is active.
    await expect(page.getByRole('heading', { name: 'Real-Time AI-Powered Speech Coaching' })).toBeVisible({ timeout: 10000 });
  });
});
