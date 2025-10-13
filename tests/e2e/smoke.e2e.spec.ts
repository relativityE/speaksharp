// tests/e2e/smoke.e2e.spec.ts
import { test, expect, getLogger } from './helpers';
import { programmaticLogin, stubThirdParties } from './helpers';

test.describe('Smoke Test', () => {
  test('should log in, navigate to session page, and verify core UI elements @smoke', async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);

    logger.info('smoke-test', 'Starting smoke test');

    // Stub third parties to avoid noise
    await stubThirdParties(page);

    // Step 1: Programmatic login. This helper now reliably handles auth.
    logger.info('smoke-test', 'Performing programmatic login');
    await programmaticLogin(page, 'smoke-test@example.com', 'password123', '/session');

    logger.info('smoke-test', 'Login successful, verifying session page UI');

    // Step 2: Verify we're on the session page by checking for session-specific elements
    await expect(page.getByRole('button', { name: /upgrade/i })).toBeVisible({ timeout: 10000 });
    logger.info('smoke-test', 'Upgrade button found');

    // Step 3: Verify the main navigation is present and contains the Sign Out button
    const nav = page.locator('nav');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('button', { name: /sign out/i })).toBeVisible();
    logger.info('smoke-test', 'Sign Out button found in navigation');

    logger.info('smoke-test', 'Smoke test completed successfully');
  });
});
