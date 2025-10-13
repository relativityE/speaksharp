// tests/e2e/auth.e2e.spec.ts
import { test, expect, getLogger } from './helpers';
import { AuthPage } from './poms/authPage.pom';
import { SessionPage } from './poms/sessionPage.pom';
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

    logger.info('setup', 'Navigating to auth page');
    await authPage.goto();
    logger.info('setup', 'Setup complete');
  });

  test('should allow a new user to sign up', async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);
    const email = `test-user-signup-${Date.now()}@example.com`;
    const password = 'password123';

    await test.step('Fill and submit sign-up form', async () => {
      logger.info('signup', 'Starting sign-up flow', { email });
      logger.credential('signup', email, password, false); // Log attempt

      await authPage.signUp(email, password);

      logger.info('signup', 'Sign-up form submitted');
    });

    await test.step('Verify user is signed in and can access protected routes', async () => {
      logger.info('verification', 'Waiting for post-auth state');

      // Use AuthPage.waitForPostAuth() to ensure the page has stabilized
      await authPage.waitForPostAuth();
      logger.info('verification', 'Post-auth wait complete');

      // Log successful signup
      logger.credential('signup', email, password, true);

      // Verify navigation to protected route
      logger.info('verification', 'Navigating to session page');
      await sessionPage.goto();

      logger.info('verification', 'Asserting on session page');
      await sessionPage.assertOnSessionPage();

      logger.info('verification', 'Test completed successfully');
    });
  });

  test('should show an error when signing up with an existing user email', async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);
    const email = 'existing-user@example.com';
    const password = 'password123';

    await test.step('Attempt to sign up with existing user email', async () => {
      logger.info('duplicate-signup', 'Attempting sign-up with existing email', { email });
      logger.credential('duplicate-signup', email, password, false);

      await authPage.signUp(email, password);

      logger.info('duplicate-signup', 'Sign-up form submitted (expecting error)');
    });

    await test.step('Verify user exists error is shown', async () => {
      logger.info('error-verification', 'Looking for user exists error message');

      await authPage.assertUserExistsError();

      logger.info('error-verification', 'User exists error confirmed');
      logger.credential('duplicate-signup', email, password, false); // Confirm failure
    });
  });

  test('should allow an existing user to sign in', async ({ page }, testInfo) => {
    const logger = getLogger(testInfo.title);
    const email = 'test-user-signin@example.com';
    const password = 'password123';

    await test.step('Programmatically login an existing user', async () => {
      logger.info('signin', 'Starting programmatic login', { email });

      // Pass logger to programmaticLogin for detailed logging
      await programmaticLogin(page, email, password);

      logger.info('signin', 'Programmatic login complete');
    });

    await test.step('Verify user is signed in and can access protected routes', async () => {
      logger.info('verification', 'Navigating to protected session page');

      await sessionPage.goto();
      logger.info('verification', 'On session page');

      await sessionPage.assertOnSessionPage();
      logger.info('verification', 'Successfully verified on session page');
    });
  });
});
