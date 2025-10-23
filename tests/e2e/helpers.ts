import { Page, expect } from '@playwright/test';
// Note: We cannot import directly from 'src/...' because Playwright runs in a different context.
// The logic from test-user-utils is effectively duplicated in the Python script for verification,
// and here we will construct it manually for the Node.js test runner, ensuring it's consistent.

function generateFakeJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: "test-user-123",
    email: "test@example.com",
    aud: "authenticated",
    role: "authenticated",
    exp: now + 3600,
    iat: now,
    session_id: "test-session-123",
  })).toString("base64url");
  const signature = "fake-signature-for-e2e-testing";
  return `${header}.${payload}.${signature}`;
}

export async function programmaticLogin(page: Page) {
  await page.addInitScript(() => {
    window.TEST_MODE = true;
    window.__E2E_MODE__ = true;
  });

  await page.goto('/');

  const fakeAccessToken = generateFakeJWT();
  const now = Math.floor(Date.now() / 1000);

  // Wait for the app to expose __setSupabaseSession
  await expect
    .poll(
      async () => await page.evaluate(() => typeof window.__setSupabaseSession === 'function'),
      { timeout: 15000 }
    )
    .toBe(true);

  // Set fake Supabase session
  await page.evaluate(
    ({ token, timestamp }) => {
      const fakeSession = {
        access_token: token,
        refresh_token: 'fake-refresh-token-for-e2e',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: timestamp + 3600,
        user: {
          id: 'test-user-123',
          email: 'test@example.com',
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: { name: 'Test User' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };
      // @ts-expect-error This is a test-specific function injected into the window object.
      window.__setSupabaseSession(fakeSession);
    },
    { token: fakeAccessToken, timestamp: now }
  );

  // Wait until both app state AND DOM confirm login
  await page.waitForFunction(
    () => window.__E2E_PROFILE_LOADED__ === true,
    { timeout: 15000 }
  );

  await page.waitForSelector('[data-testid="nav-sign-out-button"]', { timeout: 15000 });
  await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();

  // After setting the session, also set the profile:
  await page.evaluate(() => {
    window.__E2E_MOCK_PROFILE__ = {
      id: 'test-user-123',
      email: 'test@example.com',
      subscription_status: 'pro', // or 'free' for premium tests
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}
