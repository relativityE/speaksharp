// tests/e2e/smoke.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';
import { stubThirdParties } from './sdkStubs';

test.describe('Smoke Test', () => {
  test.beforeEach(async ({ page }) => {
    await stubThirdParties(page);
    await programmaticLogin(page);
  });

  test('should log in, navigate to session page, and verify core UI elements @smoke', async ({ page }) => {
    await test.step('Manually navigate to the session page after login', async () => {
      await page.goto('/session');
      // We wait for the heading to be visible as a sign that the page has loaded.
      await expect(page.getByRole('heading', { name: 'Practice Session' })).toBeVisible({ timeout: 10000 });
    });

    await test.step('Verify that the main application navigation is visible', async () => {
      const navLocator = page.locator('nav');
      await expect(navLocator).toBeVisible();
    });

    await test.step('Verify the main heading is present', async () => {
      const heading = page.getByRole('heading', { name: 'Practice Session' });
      await expect(heading).toBeVisible();
    });
  });
});