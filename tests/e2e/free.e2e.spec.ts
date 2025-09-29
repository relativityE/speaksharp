import { test, expect } from '../setup/verifyOnlyStepTracker';
import { loginUser } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';
import { TEST_USER_FREE } from '../constants';

test.describe('Free User Flow', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    // Log in as a free user before each test
    await loginUser(page, TEST_USER_FREE.email, TEST_USER_FREE.password);
    sessionPage = new SessionPage(page);
    await sessionPage.goto();
  });

  test('should display the correct UI for a free user', async ({ page }) => {
    await expect(page.getByText('Free Plan')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
  });

  test('should allow a free user to start and stop a session', async () => {
    await sessionPage.startSession();
    await sessionPage.assertSessionIsActive();
    await sessionPage.stopSession();
    await sessionPage.assertSessionIsStopped();
  });
});