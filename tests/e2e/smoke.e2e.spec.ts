// tests/e2e/smoke.e2e.spec.ts
import { test, expect, getLogger } from './helpers';
import { programmaticLogin, stubThirdParties } from './helpers';

test.describe('Smoke Test', () => {
  test('should log in, navigate to session page, and verify core UI elements @smoke', async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);

  test('should log in, navigate to session page, and verify core UI elements @smoke', async ({ page }) => {
    // First, programmatically log in the user.
    await programmaticLogin(page, 'smoke-test-user@example.com');

    // To fix the race condition, we first navigate to a protected route
    // and wait for it to load completely. This ensures the app has re-rendered
    // in its authenticated state before we make any assertions.
    sessionPage = new SessionPage(page);
    await sessionPage.goto();

    // Now that the session page is loaded, we can reliably check for elements
    // that should be visible for an authenticated user.
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
    await expect(page.getByRole('button', { name: /upgrade/i })).toBeVisible();
  });
});
