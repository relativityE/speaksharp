// tests/e2e/auth.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { AuthPage } from './poms/authPage.pom';
import { SessionPage } from './poms/sessionPage.pom';
import { stubThirdParties } from './sdkStubs';

// Get Supabase URL from environment variables for mocking. This is crucial for robust mocking.
const supabaseUrl = process.env.VITE_SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL is not defined. Please check your .env.test file.');
}

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

  test('should allow a new user to sign up', async () => {
    await test.step('Fill and submit sign-up form', async () => {
      // Use a unique email to ensure this test is always for a "new" user.
      // This relies on the default MSW handler which allows any non-existing user to sign up.
      await authPage.signUp(`test-user-${Date.now()}@example.com`, 'password123');
    });

    await test.step('Verify navigation to session page', async () => {
      await sessionPage.assertOnSessionPage();
      await expect(sessionPage.page.getByText('Start For Free')).toBeVisible();
    });
  });

  test('should show an error when signing up with an existing user email', async () => {
    await test.step('Attempt to sign up with existing user email', async () => {
      // This test relies on the default MSW handler being configured
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

    // Mock the API endpoint for a successful login for this specific user.
    // This makes the test self-contained and independent of other tests or global mock states.
    await page.route(`${supabaseUrl}/auth/v1/token?grant_type=password`, async (route) => {
      // Ensure we are only mocking the intended login request
      if (route.request().postDataJSON()?.email === email) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: 'mock-access-token-signin',
            token_type: 'bearer',
            expires_in: 3600,
            refresh_token: 'mock-refresh-token',
            user: {
              id: 'mock-user-id-signin',
              aud: 'authenticated',
              role: 'authenticated',
              email: email,
              user_metadata: { subscription_status: 'free' },
            },
          }),
        });
        return; // Stop processing this route
      }
      // For any other request, let it fall through to MSW or the network
      await route.continue();
    });

    await test.step('Fill and submit login form', async () => {
      await authPage.login(email, password);
    });

    await test.step('Verify navigation to session page', async () => {
      await sessionPage.assertOnSessionPage();
      await expect(page.getByText('Start For Free')).toBeVisible();
    });
  });
});