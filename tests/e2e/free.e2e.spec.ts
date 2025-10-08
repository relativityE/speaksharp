// tests/e2e/free.e2e.spec.ts
import { test, expect } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';
import { stubThirdParties } from './sdkStubs';

test.describe('Free User Flow', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page, login }) => {
    // Stub out third-party services before logging in.
    await stubThirdParties(page);

    await test.step('Programmatically log in as a free user', async () => {
      // Rely on the default free user from the login fixture
      await login();
    });

    sessionPage = new SessionPage(page);
  });

  test('should display the correct UI for a free user', async ({ page }) => {
    await test.step('Verify free plan UI elements are visible', async () => {
      // After login, the user is on the root page. The "Upgrade to Pro" button
      // should be visible somewhere on this page for a free user.
      await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
    });
  });

  test('should allow a free user to start and stop a session', async () => {
    // For this test, we need to be on the session page.
    await sessionPage.goto();

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