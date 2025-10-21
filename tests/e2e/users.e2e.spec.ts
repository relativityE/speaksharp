import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('User Tier Flows', () => {
  test('should not show the upgrade banner for a pro user', async ({ page }) => {
    // The default programmaticLogin logs in a 'pro' user.
    await programmaticLogin(page);

    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Your Dashboard' })).toBeVisible();

    // For a 'pro' user, the upgrade banner should not be visible.
    await expect(page.getByTestId('analytics-page-upgrade-button')).not.toBeVisible();
  });
});
