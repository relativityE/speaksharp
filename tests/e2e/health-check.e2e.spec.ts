// tests/e2e/health-check.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin, capturePage } from './helpers';

test.describe('@health-check Health Check', () => {
  test('should successfully authenticate and capture homepage states', async ({ page }) => {
    // UNAUTH
    await page.goto('/');
    await capturePage(page, 'healthcheck-homepage-unauth.png', 'unauth');
    await expect(page.getByRole('link', { name: 'Sign In' })).toBeVisible();

    // AUTH
    await programmaticLogin(page);
    await capturePage(page, 'healthcheck-homepage-auth.png', 'auth');
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();
  });
});
