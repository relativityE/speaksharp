// tests/e2e/auth.e2e.spec.ts
import { test, expect } from './helpers';
import { AuthPage } from './poms/authPage.pom';
import { SessionPage } from './poms/sessionPage.pom';
import { stubThirdParties } from './sdkStubs';

test.describe('Authentication', () => {
  let authPage: AuthPage;
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    // Stub out any third-party services that are not relevant to this test
    await stubThirdParties(page);
    authPage = new AuthPage(page);
    sessionPage = new SessionPage(page);
    await authPage.goto();
  });

  test('should allow a new user to sign up', async ({ page }) => {
    await test.step('Fill and submit sign-up form', async () => {
      await authPage.signUp(`test-user-${Date.now()}@example.com`, 'password123');
    });

    await test.step('Verify success message is shown', async () => {
      // The app shows a success message, it does not auto-login.
      await expect(page.getByText(/Success! Please check your email/i)).toBeVisible({ timeout: 10000 });
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
    const email = 'test-user-signin@example.com';
    const password = 'password123';

    await test.step('Fill and submit login form', async () => {
      await authPage.login(email, password);
    });

    await test.step('Verify user is signed in and can access protected routes', async () => {
      // After login, the user should be on a protected route.
      await sessionPage.assertOnSessionPage();
    });
  });
});