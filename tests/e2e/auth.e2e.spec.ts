import { test, expect } from './fixtures';
import { navigateToRoute } from './helpers';

test.describe('Authentication', () => {
  test('should allow a logged-in user to access protected routes with full hydration', async ({ userPage }) => {
    // Behavioral Verification: Check data-app-ready attribute on html element
    const html = userPage.locator('html');
    await expect(html).toHaveAttribute('data-app-ready', 'true', { timeout: 15000 });

    // Navigate to a protected route using navigateToRoute.
    await navigateToRoute(userPage, '/analytics');

    // Behavioral Assertion: Verify dashboard renders and has correct behavioral state
    await expect(userPage.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });
  });
});
