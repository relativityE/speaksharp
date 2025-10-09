// tests/e2e/auth.e2e.spec.ts
import { test, expect } from './helpers';
import { AuthPage } from './poms/authPage.pom';
import { SessionPage } from './poms/sessionPage.pom';
import { stubThirdParties, programmaticLogin } from './helpers';

test.describe('Authentication', () => {
  let authPage: AuthPage;
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    await stubThirdParties(page);
    authPage = new AuthPage(page);
    sessionPage = new SessionPage(page);
    await authPage.goto();
  });

  test('should allow a new user to sign up', async ({ page }) => {
    const email = `test-user-signup-${Date.now()}@example.com`;

    await test.step('Fill and submit sign-up form', async () => {
      await authPage.signUp(email, 'password123');
    });

    await test.step('Verify user is signed in and can access protected routes', async () => {
      // Use AuthPage.waitForPostAuth() to ensure the page has stabilized
      await authPage.waitForPostAuth();

      // Verify navigation to protected route
      await sessionPage.goto();
      await sessionPage.assertOnSessionPage();
    });
  });

  test('should show an error when signing up with an existing user email', async () => {
    await test.step('Attempt to sign up with existing user email', async () => {
      await authPage.signUp('existing-user@example.com', 'password123');
    });

    await test.step('Verify user exists error is shown', async () => {
      await authPage.assertUserExistsError();
    });
  });

  test('should allow an existing user to sign in', async ({ page }) => {
    await test.step('Programmatically login an existing user', async () => {
      await programmaticLogin(page, 'test-user-signin@example.com', 'password123');
    });

    await test.step('Verify user is signed in and can access protected routes', async () => {
      await sessionPage.goto();
      await sessionPage.assertOnSessionPage();
    });
  });
});