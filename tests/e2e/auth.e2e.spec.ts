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

      // After login, the user is on the homepage. Navigate to a protected route using navigateToRoute.
      await navigateToRoute(page, '/analytics');

      // ✅ Expert Fix: Rely on behavioral synchronization, not networkidle.
      // Playwright will auto-retry until the element is visible and has the correct text.
      await expect(page.getByTestId('dashboard-heading')).toHaveText('Your Analytics', { timeout: 15000 });
    });
  });
});
