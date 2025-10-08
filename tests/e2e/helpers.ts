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
    // This script runs before any application code, disabling the auth listener
    // that causes race conditions with our programmatic login.
    await page.addInitScript(() => {
      // Mock the onAuthStateChange listener to prevent it from overwriting our mock session
      window.supabase = {
        auth: {
          onAuthStateChange: () => ({
            data: { subscription: { unsubscribe: () => {} } },
          }),
        },
      } as any;
    });

    // Navigate to the root first to establish the correct origin.
    await page.goto('/');
    // Now that we are on the correct origin, clear localStorage.
    await page.evaluate(() => localStorage.clear());
    // Wait for MSW to be ready before proceeding.
    await page.waitForFunction(() => window.mswReady, null, { timeout: 60_000 });
    await use(page);
  },
  login: async ({ page }, use) => {
    await use(async (user?: MockUser) => {
      const mockUser = user || {
        id: 'e7a27341-3333-4f58-9411-92a881792634',
        email: 'test@example.com',
        subscription_status: 'free',
      };

      const mockSession = {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: {
          id: mockUser.id,
          email: mockUser.email,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: { subscription_status: mockUser.subscription_status || 'free' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };

      // Set the mock session in localStorage.
      await page.evaluate((session) => {
        localStorage.setItem('speaksharp-session', JSON.stringify(session));
      }, mockSession);

      // Reload the page to allow the AuthProvider to consume the new session.
      await page.reload();

      // Wait for MSW to be ready AGAIN after the reload.
      await page.waitForFunction(() => window.mswReady, null, { timeout: 15000 });

      // Wait for the AuthProvider's specific loading skeleton to disappear.
      await expect(page.locator('.h-24.w-24.rounded-full')).not.toBeVisible({ timeout: 15000 });
    });
  },
});

// Re-export expect so tests can import it from this central helper.
export { expect };
export type { Page, Response };