import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Authentication', () => {
  test('should allow a logged-in user to access protected routes', async ({ page }) => {
    await test.step('Programmatically log in', async () => {
      await programmaticLogin(page);
    });

    await test.step('Verify user can access protected session page', async () => {
      // After login, the user is on the homepage. Navigate to a protected route.
      await page.goto('/analytics');

      // Verify that the analytics page loads correctly by checking for its heading.
      await expect(page.getByRole('heading', { name: 'Your Dashboard' })).toBeVisible();
    });
  });
});
