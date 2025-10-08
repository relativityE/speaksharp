// tests/e2e/auth.e2e.spec.ts
import { test, expect } from './fixtures/mswFixture';
import { AuthPage } from './poms/authPage.pom';
import { SessionPage } from './poms/sessionPage.pom';
import { stubThirdParties } from './sdkStubs';

// The Supabase URL check is no longer needed as MSW will intercept API calls.

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
      // Use a unique email to ensure this test is always for a "new" user.
      await authPage.signUp(`test-user-${Date.now()}@example.com`, 'password123');
    });

    await test.step('Verify user is signed in and can access protected routes', async () => {
      // Instead of checking for a URL change which can be racy,
      // we wait for a reliable element that only appears after login.
      await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();

      // Now that we've confirmed login, we can proceed to check other pages.
      await sessionPage.goto();
      await sessionPage.assertOnSessionPage();
    });
  });

  test('should show an error when signing up with an existing user email', async () => {
    await test.step('Attempt to sign up with existing user email', async () => {
      // This test relies on the MSW handler being configured
      // to reject 'existing-user@example.com'.
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
      // Instead of checking for a URL change which can be racy,
      // we wait for a reliable element that only appears after login.
      await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();

      // Now that we've confirmed login, we can proceed to check other pages.
      await sessionPage.goto();
      await sessionPage.assertOnSessionPage();
    });
  });
});