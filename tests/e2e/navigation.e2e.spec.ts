import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('App Navigation', () => {
  test.skip('should navigate to all application routes successfully', async ({ page }) => {
    await programmaticLogin(page);

    // Test navigation to each route and verify URL + key element
    const routes = [
      { path: '/', heading: 'Transform Your Communication Skills' },
      { path: '/session', heading: 'Practice Session' },
      { path: '/analytics', heading: 'Your Dashboard' },
      { path: '/sessions', heading: 'Session History' },
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page).toHaveURL(route.path);
      await expect(page.getByRole('heading', { name: new RegExp(route.heading, 'i') })).toBeVisible();
    }
  });

  test('should navigate using nav links', async ({ page }) => {
    await programmaticLogin(page);
    await page.goto('/');

    // Click nav link to Session
    await page.getByRole('link', { name: /session/i }).first().click();
    await expect(page).toHaveURL('/session');

    // Click nav link to Analytics
    await page.getByRole('link', { name: /analytics/i }).first().click();
    await expect(page).toHaveURL('/analytics');

    // Click nav link to Home
    await page.getByRole('link', { name: /home/i }).first().click();
    await expect(page).toHaveURL('/');
  });
});
