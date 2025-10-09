import { test, expect, programmaticLogin } from './helpers';

test.describe('App Navigation', () => {
  test('should allow navigation between pages from the sidebar', async ({ page }) => {
    await programmaticLogin(page, 'nav-user@example.com');

    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByText('Settings Page')).toBeVisible();

    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible();
  });
});