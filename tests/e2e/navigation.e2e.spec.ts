import { test, expect } from '../setup/verifyOnlyStepTracker';

test.describe('App Navigation', () => {
  test.use({ storageState: 'storage/pro.json' });

  const pagesToTest = [
    { name: 'Analytics', url: '/analytics', heading: 'Speaking Analytics' },
    { name: 'Pricing', url: '/pricing', heading: 'Pricing Plans' },
  ];

  test('should allow navigation between pages from the sidebar', async ({ page }) => {
    await page.goto('/session');

    for (const targetPage of pagesToTest) {
      // Click the link in the sidebar
      await page.getByRole('link', { name: targetPage.name }).click();

      // Verify the URL has changed
      await expect(page).toHaveURL(targetPage.url);

      // Verify the page has loaded by checking for its main heading
      await expect(page.getByRole('heading', { name: targetPage.heading })).toBeVisible();
    }

    // Finally, test navigation back to the session page
    await page.getByRole('link', { name: 'Session' }).click();
    await expect(page).toHaveURL('/session');
    await expect(page.getByRole('heading', { name: 'Practice Session' })).toBeVisible();
  });
});