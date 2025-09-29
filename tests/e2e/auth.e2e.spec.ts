import { test, expect } from '../setup/verifyOnlyStepTracker';
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