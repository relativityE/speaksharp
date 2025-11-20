import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('App Navigation', () => {
  test('should allow navigation between pages from the main navigation', async ({ page }) => {
    await programmaticLogin(page);

    // From the homepage, navigate to the Analytics page
    await page.goto('/analytics');
    await expect(page).toHaveURL('/analytics');
    await expect(page.getByRole('heading', { name: 'Your Dashboard' })).toBeVisible();

    // Navigate from Analytics to the Session page
    await page.goto('/sessions');
    await expect(page).toHaveURL('/sessions');
    await expect(page.getByRole('heading', { name: 'Live Transcript' })).toBeVisible();

    // Navigate back to the Home page
    await page.goto('/');
    await expect(page).toHaveURL('/');
  });
});
