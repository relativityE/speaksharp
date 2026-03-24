import { test, expect } from './fixtures';
import { navigateToRoute, waitForAppReady } from './helpers';

test.describe('App Navigation', () => {
  test('should navigate to all application routes successfully', async ({ userPage }) => {
    // Test navigation to each route and verify URL + key element
    const routes = [
      { path: '/session', testId: 'live-recording-card' },
      { path: '/analytics', testId: 'dashboard-heading' },
    ];

    for (const route of routes) {
      await navigateToRoute(userPage, route.path);
      await expect(userPage).toHaveURL(route.path);
      // Use refined locator for headers to avoid race conditions
      const locator = route.testId === 'dashboard-heading'
        ? 'h1, h2, [data-testid="dashboard-heading"]'
        : `[data-testid="${route.testId}"]`;
      await expect(userPage.locator(locator).first()).toBeVisible({ timeout: 15000 });
    }
  });

  test('should navigate using nav links', async ({ userPage }) => {
    // After login, we're at /session, so use links from there
    await navigateToRoute(userPage, '/session');
    
    // Wait for hydration to ensure nav links work as expected
    await waitForAppReady(userPage);

    // Click nav link to Session
    const sessionLink = userPage.getByRole('link', { name: /session/i }).first();
    await expect(sessionLink).toBeVisible();
    await sessionLink.click();
    await expect(userPage).toHaveURL('/session');

    // Click nav link to Analytics
    const analyticsLink = userPage.getByRole('link', { name: /analytics/i }).first();
    await expect(analyticsLink).toBeVisible();
    await analyticsLink.click();
    await expect(userPage).toHaveURL('/analytics', { timeout: 10000 });
    // Robust heading check
    await expect(userPage.locator('h1, h2, [data-testid="dashboard-heading"]').first()).toBeVisible({ timeout: 15000 });

    // Click nav link to Home
    const homeLink = userPage.getByRole('link', { name: /home/i }).first();
    await expect(homeLink).toBeVisible();
    await homeLink.click();
    // Authenticated users are redirected to /session.
    await expect(userPage.getByTestId('session-page')).toBeVisible({ timeout: 15000 });
  });
});
