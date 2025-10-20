// tests/e2e/health-check.e2e.spec.ts
import { test, expect } from './helpers';
import { stubThirdParties } from './helpers';

test.describe('Health Check', () => {
  test('should load the homepage successfully', async ({ page }) => {
    await stubThirdParties(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Real-Time AI-Powered Speech Coaching' })).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/health-check-success.png' });
  });
});
