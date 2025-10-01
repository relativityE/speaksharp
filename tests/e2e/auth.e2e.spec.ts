import { test, expect } from '../setup/verifyOnlyStepTracker';
import { AuthPage } from './poms/authPage.pom';
import { SessionPage } from './poms/sessionPage.pom';
import { stubThirdParties } from './sdkStubs';

test.describe('Authentication', () => {
  let authPage: AuthPage;
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    // The global setup navigates to `/` and waits for MSW.
    // We still need to stub third-party services and initialize Page Object Models.
    await stubThirdParties(page);
    authPage = new AuthPage(page);
    sessionPage = new SessionPage(page);
    // Note: The call to authPage.goto() is no longer needed as the global
    // setup already navigates to the root page.
  });

  test('should allow a user to sign up', async () => {
    await authPage.signUp('test-user@example.com', 'password123');
    await sessionPage.assertOnSessionPage();
    await expect(sessionPage.page.getByText('Start For Free')).toBeVisible();
  });

  test('should show an error for an existing user', async () => {
    await authPage.signUp('existing-user@example.com', 'password123');
    await authPage.assertUserExistsError();
  });

  test('should allow a user to sign in', async ({ page }) => {
    await authPage.login('test-user@example.com', 'password123');
    await sessionPage.assertOnSessionPage();
    await expect(page.getByText('Start For Free')).toBeVisible();
  });
});