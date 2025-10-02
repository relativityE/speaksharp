// tests/e2e/free.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin, MockUser } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';
import { stubThirdParties } from './sdkStubs';

// Define a mock user for this test suite.
const freeUser: MockUser = {
  id: 'user-id-free',
  email: 'free-user@example.com',
  subscription_status: 'free',
};

test.describe('Free User Flow', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    // Stub out third-party services before logging in.
    await stubThirdParties(page);

    await test.step('Programmatically log in as a free user', async () => {
      await programmaticLogin(page, freeUser);
    });

    sessionPage = new SessionPage(page);
    // Note: sessionPage.goto() is no longer needed because programmaticLogin
    // handles navigation and ensures the page is ready.
  });

  test('should display the correct UI for a free user', async ({ page }) => {
    await test.step('Verify free plan UI elements are visible', async () => {
      await expect(page.getByText('Free Plan')).toBeVisible();
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