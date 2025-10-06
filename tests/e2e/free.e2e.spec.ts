// tests/e2e/free.e2e.spec.ts
import { test, expect, MockUser, loginAndWait } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';
import { stubThirdParties } from './sdkStubs';

test.describe('Free User Flow', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    // Stub out third-party services before logging in.
    await stubThirdParties(page);

    const mockUser: MockUser = {
      id: 'mock-user-id',
      email: 'free-user@test.com',
      subscription_status: 'free',
    };
    await loginAndWait(page, mockUser);

    sessionPage = new SessionPage(page);
    // After programmatic login, we must manually navigate to the session page.
    await sessionPage.goto();
  });

  test('should display the correct UI for a free user', async ({ page }) => {
    await test.step('Verify free plan UI elements are visible', async () => {
      // Use a more specific selector to ensure we are targeting the correct element
      await expect(page.locator('div').filter({ hasText: /^Free Plan$/ }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
    });
  });

  test('should allow a free user to start and stop a session', async () => {
    await test.step('Start a session', async () => {
      await sessionPage.startSession();
      await sessionPage.assertSessionIsActive();
    });

    await test.step('Stop the session', async () => {
      await sessionPage.stopSession();
      await sessionPage.assertSessionIsStopped();
    });
  });
});