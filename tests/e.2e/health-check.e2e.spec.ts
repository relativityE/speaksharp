import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Health Check', () => {
  test('should load the homepage successfully', async ({ page }) => {
    // This helper now uses a hardcoded test user email, so no argument is needed.
    await programmaticLogin(page);

    // Verify that the login was successful and the main app content is visible.
    await expect(page.getByRole('heading', { name: 'Real-Time AI-Powered Speech Coaching' })).toBeVisible({ timeout: 10000 });

    // Capture a screenshot for verification.
    await page.screenshot({ path: 'test-results/health-check-success.png' });
  });
});
