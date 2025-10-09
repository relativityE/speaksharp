// tests/e2e/auth.e2e.spec.ts
import { test, expect } from './helpers';
import { AuthPage } from './poms/authPage.pom';
import { SessionPage } from './poms/sessionPage.pom';
import { HomePage } from './poms/homePage.pom';
import { stubThirdParties } from './sdkStubs';

// The Supabase URL check is no longer needed as MSW will intercept API calls.

test.describe('Authentication', () => {
  let authPage: AuthPage;
  let sessionPage: SessionPage;
  let homePage: HomePage;

  test.beforeEach(async ({ page }) => {
    // Stub out any third-party services that are not relevant to this test
    await stubThirdParties(page);
    authPage = new AuthPage(page);
    sessionPage = new SessionPage(page);
    homePage = new HomePage(page);
    await authPage.goto();
  });

  test('should allow a new user to sign up', async ({ page }) => {
    await test.step('Fill and submit sign-up form', async () => {
      // Use a consistent email to rely on MSW, but make it unique enough
      // to avoid conflicts if tests were ever run against a real backend.
      const email = `test-user-signup-${Date.now()}@example.com`;
      await authPage.signUp(email, 'password123');
    });

    await test.step('Verify user is signed in and can access protected routes', async () => {
      // Wait for the home page to be ready by waiting for a known element to be visible.
      await expect(homePage.startFreeSessionButton).toBeVisible({ timeout: 15000 });
      // After a successful sign-up, the app should redirect to the root page
      // where the 'Sign Out' button is visible.
      await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: 15000 });

      // Additionally, verify navigation to a protected route works.
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
    await test.step('Fill and submit login form', async () => {
      // This test relies on the MSW handler being configured
      // to accept 'test-user-signin@example.com'.
      await authPage.login('test-user-signin@example.com', 'password123');
    });

    await test.step('Verify user is signed in and can access protected routes', async () => {
      // Wait for the home page to be ready by waiting for a known element to be visible.
      await expect(homePage.startFreeSessionButton).toBeVisible({ timeout: 15000 });
      // After a successful sign-in, the app should redirect to the root page
      // where the 'Sign Out' button is visible.
      await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: 15000 });

      // Additionally, verify navigation to a protected route works.
      await sessionPage.goto();
      await sessionPage.assertOnSessionPage();
    });
  });
});