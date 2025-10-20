// tests/e2e/isolated-smoke.e2e.spec.ts
import { test, expect, getLogger } from './helpers';
import { programmaticLogin, stubThirdParties } from './helpers';
import { AnalyticsPage, SessionPage } from '../pom';

test.describe('Isolated Smoke Test', () => {
  test('should perform a full user journey: login, start session, view analytics, and log out @isolated-smoke', async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);
    logger.info('isolated-smoke-test', 'Starting comprehensive smoke test');

    await stubThirdParties(page);

    // Step 1: Programmatic login
    logger.info('isolated-smoke-test', 'Performing programmatic login');
    await programmaticLogin(page, 'smoke-test@example.com');
    logger.info('isolated-smoke-test', 'Login successful');

    // Step 2: Navigate to Session Page and start a session
    const sessionPage = new SessionPage(page);
    await sessionPage.navigate();
    logger.info('isolated-smoke-test', 'Navigated to session page');
    await expect(sessionPage.startButton).toBeVisible();
    await sessionPage.startButton.click();
    logger.info('isolated-smoke-test', 'Session started');

    await expect(page.getByTestId('session-in-progress-indicator')).toBeVisible({ timeout: 15000 });
    logger.info('isolated-smoke-test', 'Session in-progress UI is visible');

    // Step 3: Navigate to Analytics Page
    const analyticsPage = new AnalyticsPage(page);
    await analyticsPage.navigate();
    logger.info('isolated-smoke-test', 'Navigated to analytics page');

    // Step 4: Verify Analytics Page core elements
    await expect(analyticsPage.heading).toBeVisible();
    logger.info('isolated-smoke-test', 'Analytics dashboard heading is visible');
    await expect(analyticsPage.upgradeBanner).toBeVisible();
    logger.info('isolated-smoke-test', 'Upgrade banner is visible as expected for free user');

    // Step 5: Log out
    const navSignOutButton = page.getByTestId('nav-sign-out-button');
    await expect(navSignOutButton).toBeVisible();
    await navSignOutButton.click();
    logger.info('isolated-smoke-test', 'Clicked sign out button');

    // Step 6: Verify successful logout
    const navSignInButton = page.getByTestId('nav-sign-in-button');
    await expect(navSignInButton).toBeVisible({ timeout: 10000 });
    await expect(navSignOutButton).not.toBeVisible();
    expect(page.url()).not.toContain('/analytics');
    expect(page.url()).not.toContain('/session');
    logger.info('isolated-smoke-test', 'Logout successful, user is on home page');

    logger.info('isolated-smoke-test', 'Comprehensive smoke test completed successfully');
  });
});
