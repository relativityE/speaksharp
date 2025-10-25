import { Page, expect } from '@playwright/test';

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
    (window as any).TEST_MODE = true;
    (window as any).__E2E_MODE__ = true;
  });

  await page.goto('/');
  console.log('✅ Page loaded');

  // Wait for supabase client to be available
  await page.waitForFunction(() => (window as any).supabase, { timeout: 10000 });
  console.log('✅ Supabase client ready');

  // Wait for initial app mount (loading skeleton disappears)
  await page.waitForFunction(
    () => {
      const loadingSkeleton = document.querySelector('[data-testid="loading-skeleton"]');
      return !loadingSkeleton;
    },
    { timeout: 15000 }
  );
  console.log('✅ App initialized (no loading skeleton)');

  const fakeAccessToken = generateFakeJWT();
  const now = Math.floor(Date.now() / 1000);

  // Set mock profile BEFORE session
  await page.evaluate(() => {
    (window as any).__E2E_MOCK_PROFILE__ = {
      id: 'test-user-123',
      email: 'test@example.com',
      subscription_status: 'pro',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
  console.log('✅ Mock profile set');

  // Set session and wait for it to complete
  await page.evaluate(
    async ({ token, timestamp }) => {
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

      console.log('[Test] Setting session...');
      const result = await (window as any).supabase.auth.setSession(fakeSession);
      console.log('[Test] Session set result:', result);
      // Manually dispatch an event to force the AuthProvider to re-render
      window.dispatchEvent(new CustomEvent('__E2E_SESSION_INJECTED__', { detail: fakeSession }));
    },
    { token: fakeAccessToken, timestamp: now }
  );
  console.log('✅ Session injected');

  // Wait for profile to load
  await page.waitForFunction(
    () => (window as any).__E2E_PROFILE_LOADED__ === true,
    { timeout: 15000 }
  );
  console.log('✅ Profile loaded');

  // Wait for authenticated UI (sign-out button)
  await page.waitForSelector('[data-testid="nav-sign-out-button"]', {
    timeout: 15000,
    state: 'visible'
  });

  await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();
  console.log('✅ Login complete - authenticated UI visible');
}
