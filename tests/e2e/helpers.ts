import { test as base, expect, Page, Response } from '@playwright/test';

// ---------------------------------
// Type Definitions
// ---------------------------------

export type MockUser = {
  id: string;
  email: string;
  subscription_status?: 'free' | 'pro';
};

// ---------------------------------
// Custom Test Fixture
// ---------------------------------

export const test = base.extend<{
  login: (user?: MockUser) => Promise<void>;
}>({
  page: async ({ page }, use) => {
    // Before each test, navigate to the root and wait for MSW to be ready.
    // This ensures a clean state and that mocking is active.
    await page.goto('/');
    await page.waitForFunction(() => window.mswReady, null, { timeout: 60_000 });
    await use(page);
  },
  login: async ({ page }, use) => {
    await use(async (user?: MockUser) => {
      // Define a default mock user if none is provided.
      const mockUser = user || {
        id: '1',
        email: 'test@example.com',
        subscription_status: 'free',
      };

      // Create a mock session object that mimics the real session structure.
      const mockSession = {
        user: {
          id: mockUser.id,
          email: mockUser.email,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: { provider: 'email' },
          user_metadata: { subscription_status: mockUser.subscription_status },
        },
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
      };

      // Use page.evaluate to set the session in localStorage.
      // This is fast and does not require a page reload.
      await page.evaluate((session) => {
        localStorage.setItem('speaksharp-session', JSON.stringify(session));
      }, mockSession);

      // Reload the page to allow the AuthProvider to consume the new session.
      await page.reload();

      // After reload, the app will be in a logged-in state.
      // Verify login was successful by checking for a sign-out button.
      await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible({ timeout: 15_000 });
    });
  },
});

// Re-export expect so tests can import it from this central helper.
export { expect };
export type { Page, Response };