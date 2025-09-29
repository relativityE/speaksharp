import { test, expect } from '../setup/verifyOnlyStepTracker';
import { AuthPage } from './poms/authPage.pom';
import { SessionPage } from './poms/sessionPage.pom';
import { stubThirdParties } from './sdkStubs';
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from '../constants';

test.describe('Authentication', () => {
  test('should allow a user to sign up and land on the session page', async ({ page }) => {
    await stubThirdParties(page);
    const authPage = new AuthPage(page);
    const sessionPage = new SessionPage(page);

    await authPage.goto();

    // Switch to sign up view
    await authPage.modeToggleButton.click();

    // Fill in sign up form
    await authPage.emailInput.fill(TEST_USER_EMAIL);
    await authPage.passwordInput.fill(TEST_USER_PASSWORD);
    await authPage.signUpButton.click();

    // After signing up, the user should be on the session page
    await sessionPage.verifyOnPage();

    // The URL should be /session
    await expect(page).toHaveURL('/session');
  });
});
