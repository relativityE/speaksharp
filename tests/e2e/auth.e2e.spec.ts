import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';

test.describe('Authentication', () => {
  test('should allow a logged-in user to access protected routes', async ({ page }) => {
    await test.step('Programmatically log in', async () => {
      await programmaticLoginWithRoutes(page);
    });

    await test.step('Verify user can access protected session page', async () => {
      // Ensure fresh state and synchronize MSW
      await page.reload();
      await page.waitForLoadState('networkidle');

      // After login, the user is on the homepage. Navigate to a protected route using navigateToRoute.
      await navigateToRoute(page, '/analytics');
      // ✅ Wait for analytics page to fully load (Senior Engineer Rec)
      await page.waitForLoadState('networkidle');

      // Verify that the analytics page loads correctly by checking for its heading.
      // Verify that the analytics page loads correctly by checking for its heading.
      await expect(page.getByTestId('dashboard-heading')).toContainText('Your Analytics', { timeout: 15000 });
    });
  });
});
