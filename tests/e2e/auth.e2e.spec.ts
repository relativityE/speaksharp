// tests/e2e/auth.e2e.spec.ts
import { test, getLogger, expect } from './helpers';
import { AuthPage, SessionPage } from '../pom';
import { stubThirdParties, programmaticLogin } from './helpers';

test.describe('Authentication', () => {
  let authPage: AuthPage;
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);
    logger.info('setup', 'Stubbing third-party services');
    await stubThirdParties(page);
    authPage = new AuthPage(page);
    sessionPage = new SessionPage(page);
    // No navigation here, as programmatic login handles it.
  });

  test('should allow a logged-in user to access protected routes and view the correct home page', async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);
    const email = 'test-user@example.com';

    await test.step('Programmatically log in', async () => {
      logger.info('login', 'Starting programmatic login', { email });
      await programmaticLogin(page, email);
      logger.info('login', 'Programmatic login complete');
    });

    await test.step('Verify user is on the correct home page and can access protected routes', async () => {
      logger.info('verification', 'Verifying user is on the logged-in home page');
      await authPage.waitForPostAuth(); // This correctly waits for the logged-in home page
      logger.info('verification', 'Navigating to protected session page');
      await sessionPage.goto();
      await expect(sessionPage.heading).toBeVisible();
      logger.info('verification', 'Successfully verified access to protected routes');
    });
  });
});
