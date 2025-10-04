// tests/e2e/free.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';
import { SessionPage } from './poms/sessionPage.pom';
import { stubThirdParties } from './sdkStubs';

test.describe('Free User Flow', () => {
  let sessionPage: SessionPage;

  test.beforeEach(async ({ page }) => {
    // Stub out third-party services before logging in.
    await stubThirdParties(page);

    await test.step('Programmatically log in as a free user', async () => {
      await programmaticLogin(page);
    });

    sessionPage = new SessionPage(page);
    // After programmatic login, we must manually navigate to the session page.
    await sessionPage.goto();
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