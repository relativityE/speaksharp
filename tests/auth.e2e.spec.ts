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
    // Set the E2E mode flag to bypass unsupported browser APIs like SpeechRecognition
    await page.addInitScript(() => {
      window.__E2E_MODE__ = true;
    });
  });

  test('a Pro user can access the session page without limits', async ({ page }) => {
    await stubThirdParties(page);
    // Use addInitScript to inject the mock session BEFORE any page scripts execute.
    // This is critical to avoid race conditions.
    await page.addInitScript((session) => {
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

  test('a Free user is shown an upgrade prompt when they hit their usage limit', async ({ page }) => {
    const mockFreeUser = {
      id: 'free-user-id',
      email: 'free@example.com',
      user_metadata: { subscription_status: 'free' },
    };
    const mockFreeSession = {
      access_token: 'mock-free-access-token',
      refresh_token: 'mock-free-refresh-token',
      user: mockFreeUser,
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    // Stub third parties and specifically enable the usage exceeded mock
    await stubThirdParties(page, { usageExceeded: true });

    // Inject the mock session
    await page.addInitScript((session) => {
      window.__E2E_MOCK_SESSION__ = session;
    }, mockFreeSession);


    await page.goto('/session?e2e=1');

    // Start a session
    await page.getByRole('button', { name: /Start Session/i }).click();
    // Wait for the session to be in the active listening state, indicated by the Stop button
    await expect(page.getByRole('button', { name: /Stop Session/i })).toBeVisible({ timeout: 15000 });

    // Immediately stop the session to trigger the save and usage check
    await page.getByRole('button', { name: /Stop Session/i }).click();

    // The "Session Ended" dialog should appear first
    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible();

    // Click "Go to Analytics" to trigger the save
    await page.getByRole('button', { name: 'Go to Analytics' }).click();

    // NOW, because usageExceeded was true, the upgrade prompt should be shown.
    await expect(page.getByRole('heading', { name: "You've Reached Your Free Limit" })).toBeVisible();
    await expect(page.getByText(/You've used all your free practice time for this month/)).toBeVisible();
  });
});
