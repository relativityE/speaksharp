// tests/e2e/free.e2e.spec.ts
import { test, getLogger, expect } from './helpers';
import { HomePage, SessionPage } from '../pom';
import { programmaticLogin } from './helpers';

test.describe('Free Tier User Flow', () => {
  let homePage: HomePage;

  test.beforeEach(async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);
    homePage = new HomePage(page);

    logger.info('setup', 'Starting programmatic login for free user');
    await programmaticLogin(page, 'free-user@example.com');
    logger.info('setup', 'Programmatic login complete');

    logger.info('setup', 'Navigating to home page');
    await homePage.goto();
    logger.info('setup', 'Setup complete');
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  test('should be able to access the session page', async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);
    logger.info('verification', 'Verifying session page access');
    const sessionPage = new SessionPage(page);
    await sessionPage.goto();
    await expect(sessionPage.heading).toBeVisible();
    logger.info('verification', 'Session page access verified');
  });
});
