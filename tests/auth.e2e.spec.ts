import { expect } from '@playwright/test';
import { test } from './setup';
import { stubThirdParties } from './sdkStubs';
import { waitForAppReady } from './helpers';

const mockProUser = {
  id: 'pro-user-id',
  email: 'pro@example.com',
  // The application code checks for `profile.subscription_status`.
  // This seems to be sourced from the user's metadata.
  user_metadata: { subscription_status: 'pro' },
};

const mockProSession = {
  access_token: 'mock-pro-access-token',
  refresh_token: 'mock-pro-refresh-token',
  user: mockProUser,
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};

test.describe('Authenticated User Flows', () => {
  test.beforeEach(async ({ page }) => {
    await stubThirdParties(page);
  });

  test('a Pro user can access the session page without limits', async ({ page }) => {
    // Inject the mock session into the browser context
    await page.evaluate((session) => {
      window.__E2E_MOCK_SESSION__ = session;
    }, mockProSession);

    await page.goto('/?e2e=1');

    // For an authenticated user, the app is "ready" when we see the main navigation.
    // We can't use waitForAppReady because it looks for anonymous user content.
    await expect(page.getByRole('link', { name: /Session/i })).toBeVisible({ timeout: 15000 });

    // Verify the user is "logged in" by checking for the absence of the "Sign In" button
    await expect(page.getByRole('button', { name: /Sign In/i })).not.toBeVisible();

    // Navigate to the session page and verify access
    await page.getByRole('link', { name: /Session/i }).click();
    await expect(page).toHaveURL(/.*\/session/);
    await expect(page.getByRole('button', { name: /Start Session/i })).toBeVisible();

    // A pro user should not see any upgrade prompts
    await expect(page.getByText(/Upgrade to Pro/i)).not.toBeVisible();
  });

  // TODO: Add test for free user hitting usage limit
  test.skip('a Free user is shown an upgrade prompt when they hit their usage limit', async ({ page }) => {
    // This test will require mocking the API response that indicates the user is out of free credits.
  });
});
