// tests/e2e/smoke.e2e.spec.ts
import { test, expect, getLogger } from './helpers';
import { programmaticLogin, stubThirdParties } from './helpers';

test.describe('Smoke Test', () => {
  test('should log in, navigate to session page, and verify core UI elements @smoke', async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);

    logger.info('smoke-test', 'Starting smoke test');

    // Stub third parties to avoid noise
    await stubThirdParties(page);

    // Step 1: Programmatic login (this will navigate to home page and verify Sign Out there)
    logger.info('smoke-test', 'Performing programmatic login');
    await programmaticLogin(page, 'smoke-test@example.com');

    logger.info('smoke-test', 'Login successful, user is authenticated');

    // Step 2: Now that we're logged in, navigate to session page
    logger.info('smoke-test', 'Navigating to session page');
    await page.goto('/session');

    // Wait for session page to load
    await page.waitForLoadState('networkidle');
    logger.info('smoke-test', 'On session page');

    // Step 3: Verify session-specific UI elements (NOT Sign Out, that's on home/nav)
    logger.info('smoke-test', 'Verifying session page elements');

    // Check for the "Start" button that actually exists on this page
    await expect(page.getByRole('button', { name: /start/i })).toBeVisible({ timeout: 10000 });
    logger.info('smoke-test', 'Start button found');

    // Check for upgrade button if it exists
    const upgradeButton = page.getByRole('button', { name: /upgrade/i });
    const hasUpgradeButton = await upgradeButton.count() > 0;

    if (hasUpgradeButton) {
      await expect(upgradeButton).toBeVisible();
      logger.info('smoke-test', 'Upgrade button found');
    } else {
      logger.info('smoke-test', 'Upgrade button not present (may be conditional)');
    }

    // Verify we're actually on the session page by checking URL
    expect(page.url()).toContain('/session');
    logger.info('smoke-test', 'Confirmed on session page');

    logger.info('smoke-test', 'Smoke test completed successfully');
  });
});
