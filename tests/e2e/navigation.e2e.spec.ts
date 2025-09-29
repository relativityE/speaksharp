import { test, expect } from '../setup/verifyOnlyStepTracker';

test.describe('App Navigation', () => {
  test.use({ storageState: 'storage/pro.json' });

  const pages = [
    { name: 'Session', path: '/session', heading: 'Practice Session' },
    { name: 'Analytics', path: '/analytics', heading: 'Analytics Dashboard' },
    { name: 'Pricing', path: '/pricing', heading: 'Upgrade to Pro' },
  ];

  test('should allow navigation between all main pages', async ({ page }) => {
    // Start at the main session page
    await page.goto('/session');
    await expect(page.getByRole('heading', { name: 'Practice Session' })).toBeVisible();

    for (const targetPage of pages) {
      // Navigate to the target page using the sidebar link
      await page.getByRole('link', { name: targetPage.name }).click();

      // Verify the URL is correct
      await expect(page).toHaveURL(targetPage.path);

      // Verify the page has loaded by checking for its main heading
      await expect(page.getByRole('heading', { name: targetPage.heading })).toBeVisible();
    }

    // Finally, test navigation back to the session page
    await page.getByRole('link', { name: 'Session' }).click();
    await expect(page).toHaveURL('/session');
    await expect(page.getByRole('heading', { name: 'Practice Session' })).toBeVisible();
  });
});
