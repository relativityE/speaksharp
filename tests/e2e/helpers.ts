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
    // @ts-ignore
    window.TEST_MODE = true;
    // @ts-ignore
    window.__E2E_MODE__ = true;
  });

  await page.goto('/');

  const fakeAccessToken = generateFakeJWT();
  const now = Math.floor(Date.now() / 1000);

  await page.waitForFunction(() => typeof (window as any).__setSupabaseSession === 'function', { timeout: 5000 });

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
      // @ts-ignore
      (window as any).__setSupabaseSession(fakeSession);
    },
    { token: fakeAccessToken, timestamp: now }
  );

  await page.reload();
  await page.waitForFunction(() => (window as any).__E2E_PROFILE_LOADED__ === true, { timeout: 10000 });
  await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 10000 });
}
