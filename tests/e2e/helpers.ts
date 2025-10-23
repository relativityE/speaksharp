import { Page, expect } from '@playwright/test';

// Define a user profile type for clarity and reuse.
export type UserProfile = {
  id: string;
  email: string;
  subscription_status: 'free' | 'pro';
  created_at?: string;
  updated_at?: string;
};

// A default user profile for tests that don't need a specific subscription status.
export const defaultTestUserProfile: UserProfile = {
  id: 'test-user-123',
  email: 'test@example.com',
  subscription_status: 'free',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function generateFakeJWT(profile: UserProfile) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: profile.id,
    email: profile.email,
    aud: "authenticated",
    role: "authenticated",
    exp: now + 3600,
    iat: now,
    session_id: `test-session-${profile.id}`,
  })).toString("base64url");
  const signature = "fake-signature-for-e2e-testing";
  return `${header}.${payload}.${signature}`;
}

export async function programmaticLogin(page: Page, options?: { subscriptionStatus?: 'free' | 'pro' }) {
  const subscriptionStatus = options?.subscriptionStatus ?? 'free';
  const profile: UserProfile = {
    ...defaultTestUserProfile,
    subscription_status: subscriptionStatus,
    id: subscriptionStatus === 'pro' ? 'pro-user-123' : 'test-user-123',
    email: subscriptionStatus === 'pro' ? 'pro@example.com' : 'test@example.com',
  };

  // Instead of addInitScript for the main flag, use a URL parameter
  await page.goto('/?e2e=true');

  // THEN set the profile after page starts loading
  await page.addInitScript((mockProfile) => {
    window.__E2E_MOCK_PROFILE__ = mockProfile;
  }, profile);

  // Wait for page to be interactive
  await page.waitForLoadState('domcontentloaded');

  // Now inject MSW readiness check
  await page.waitForFunction(() => window.mswReady === true, null, { timeout: 15000 });

  const fakeAccessToken = generateFakeJWT(profile);
  const now = Math.floor(Date.now() / 1000);

  // Wait for setSupabaseSession to be available
  await expect
    .poll(
      async () => await page.evaluate(() => typeof window.__setSupabaseSession === 'function'),
      { timeout: 15000 }
    )
    .toBe(true);

  // Set fake Supabase session
  await page.evaluate(
    ({ token, timestamp, userProfile }) => {
      const fakeSession = {
        access_token: token,
        refresh_token: 'fake-refresh-token-for-e2e',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: timestamp + 3600,
        user: {
          id: userProfile.id,
          email: userProfile.email,
          aud: 'authenticated',
          role: 'authenticated',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: { name: 'Test User' },
          created_at: userProfile.created_at || new Date().toISOString(),
          updated_at: userProfile.updated_at || new Date().toISOString(),
        },
      };
      window.__setSupabaseSession(fakeSession);
    },
    { token: fakeAccessToken, timestamp: now, userProfile: profile }
  );

  // Wait until both app state AND DOM confirm login
  await page.waitForFunction(
    () => window.__E2E_PROFILE_LOADED__ === true,
    { timeout: 15000 }
  );

  await page.waitForSelector('[data-testid="nav-sign-out-button"]', { timeout: 15000 });
  await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();
}
