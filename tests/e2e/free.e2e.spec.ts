// tests/e2e/free.e2e.spec.ts
import { test, getLogger } from './helpers';
import { HomePage } from './poms/homePage.pom';
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
  test('should see the upgrade prompt on the home page', async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);
    logger.info('verification', 'Verifying upgrade prompt is visible');

    await homePage.assertUpgradePromptIsVisible();

    logger.info('verification', 'Upgrade prompt is visible, test complete');
//
  });
});
