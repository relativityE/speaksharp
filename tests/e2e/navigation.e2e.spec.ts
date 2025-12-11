import { test, expect } from '@playwright/test';
import { programmaticLogin, navigateToRoute } from './helpers';

test.describe('App Navigation', () => {
  test('should navigate to all application routes successfully', async ({ page }) => {
    await programmaticLogin(page);

    // Test navigation to each route and verify URL + key element
    const routes = [
      { path: '/session', heading: 'Practice Session' },
      { path: '/analytics', heading: 'Your Dashboard' },
    ];

    for (const route of routes) {
      await navigateToRoute(page, route.path);
      await expect(page).toHaveURL(route.path);
      await expect(page.getByRole('heading', { name: new RegExp(route.heading, 'i') })).toBeVisible();
    }
  });

  test('should navigate using nav links', async ({ page }) => {
    await programmaticLogin(page);
    await page.goto('/');

    // Click nav link to Session
    await page.getByRole('link', { name: /practice/i }).first().click();
    await expect(page).toHaveURL('/session');

    // Click nav link to Analytics
    await page.getByRole('link', { name: /analytics/i }).first().click();
    await expect(page).toHaveURL('/analytics');

    // Click nav link to Home
    await page.getByRole('link', { name: /home/i }).first().click();
    // Authenticated users are redirected to /session
    await expect(page).toHaveURL('/session');
  });
});
