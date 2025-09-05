import { expect } from '@playwright/test';
import { test } from './setup';
import { stubThirdParties } from './sdkStubs';

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

const mockProUser = {
    id: 'pro-user-id',
    email: 'pro@example.com',
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
    // Set the E2E mode flag
    await page.addInitScript(() => {
      window.__E2E_MODE__ = true;
    });
    await stubThirdParties(page);
  });

  test('a Pro user can access the session page without limits', async ({ page }) => {
    await page.addInitScript((session) => {
        window.__E2E_MOCK_SESSION__ = session;
    }, mockProSession);

    await page.goto('/session?e2e=1');
    await expect(page.getByRole('button', { name: /Start Session/i })).toBeVisible();
    await expect(page.getByText(/Upgrade to Pro/i)).not.toBeVisible();
  });

  test('a Free user is shown an upgrade prompt when they hit their usage limit', async ({ page }) => {
    // Inject the mock session
    await page.addInitScript((session) => {
      window.__E2E_MOCK_SESSION__ = session;
    }, mockFreeSession);

    // CRITICAL: Inject the usage state that will trigger the upgrade prompt
    await page.addInitScript(() => {
      window.__E2E_USAGE_STATE__ = {
        usageExceeded: true  // This will force the upgrade prompt to appear
      };
    });

    await page.goto('/session?e2e=1');

    // Start a session
    await page.getByRole('button', { name: /Start Session/i }).click();

    // Wait for the session to be active
    await expect(page.getByRole('button', { name: /Stop Session/i })).toBeVisible({ timeout: 15000 });

    // Stop the session to trigger the save and usage check
    await page.getByRole('button', { name: /Stop Session/i }).click();

    // The "Session Ended" dialog should appear first
    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible();

    // Click "Go to Analytics" to trigger the save (which will use our injected state)
    await page.getByRole('button', { name: 'Go to Analytics' }).click();

    // NOW the upgrade prompt should be shown because we injected usageExceeded: true
    await expect(page.getByRole('heading', { name: "You've Reached Your Free Limit" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/You've used all your free practice time for this month/)).toBeVisible();
  });

  test('a Free user with remaining quota does NOT see upgrade prompt', async ({ page }) => {
    // Inject the mock session
    await page.addInitScript((session) => {
      window.__E2E_MOCK_SESSION__ = session;
    }, mockFreeSession);

    // Inject usage state that shows quota remaining
    await page.addInitScript(() => {
      window.__E2E_USAGE_STATE__ = {
        usageExceeded: false  // User still has quota remaining
      };
    });

    await page.goto('/session?e2e=1');

    // Start and stop session
    await page.getByRole('button', { name: /Start Session/i }).click();
    await expect(page.getByRole('button', { name: /Stop Session/i })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Stop Session/i }).click();

    // End the session normally
    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to Analytics' }).click();

    // Should NOT see the upgrade prompt
    await expect(page.getByRole('heading', { name: "You've Reached Your Free Limit" })).not.toBeVisible();
    // And we should have navigated to the analytics page
    await expect(page).toHaveURL(/.*\/analytics\/.*/);
  });
});
