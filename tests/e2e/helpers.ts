// tests/e2e/helpers.ts
import { Page, expect } from '@playwright/test';
import { MOCK_USER, MOCK_USER_PROFILE, MOCK_SESSIONS, MOCK_SESSION_KEY } from './fixtures/mockData';

function generateFakeJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: MOCK_USER.id,
    email: MOCK_USER.email,
    aud: "authenticated",
    role: "authenticated",
    exp: now + 3600,
    iat: now,
    session_id: "test-session-123",
  })).toString("base64url");
  const signature = "fake-signature-for-e2e-testing";
  return `${header}.${payload}.${signature}`;
}

// Typed interface for the mock Supabase query chain
interface SupabaseQuery<T> {
  select: () => SupabaseQuery<T>;
  eq: (column: keyof T, value: unknown) => SupabaseQuery<T> | { single: () => Promise<{ data: T | null; error: unknown }> };
  order: (_col: keyof T, _opts: { ascending: boolean }) => Promise<{ data: T[]; error: unknown }>;
  single: () => Promise<{ data: T | null; error: unknown }>;
}

export async function programmaticLogin(page: Page) {
  await page.addInitScript(() => {
    if (!(window as { __MOCK_SUPABASE_CLIENT_INITIALIZED__?: boolean }).__MOCK_SUPABASE_CLIENT_INITIALIZED__) {
      (window as { __MOCK_SUPABASE_CLIENT_INITIALIZED__?: boolean }).__MOCK_SUPABASE_CLIENT_INITIALIZED__ = true;

      let session: unknown = null;
      try {
        const storedSession = localStorage.getItem(MOCK_SESSION_KEY);
        if (storedSession) session = JSON.parse(storedSession);
      } catch (e) {
        console.error('[MockClient] Failed to parse stored session:', e);
        localStorage.removeItem(MOCK_SESSION_KEY);
      }

      const listeners = new Set<(event: string, session: unknown | null) => void>();

      (window as { supabase?: unknown }).supabase = {
        auth: {
          onAuthStateChange: (callback: (event: string, session: unknown | null) => void) => {
            listeners.add(callback);
            setTimeout(() => callback('INITIAL_SESSION', session), 0);
            return {
              data: { subscription: { unsubscribe: () => listeners.delete(callback) } },
            };
          },

          setSession: async (sessionData: Record<string, unknown>) => {
            session = { ...(sessionData as Record<string, unknown>), expires_at: Math.floor(Date.now() / 1000) + 3600 };
            try { localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(session)); }
            catch (e) { console.error('[MockClient] Failed to save session to localStorage:', e); }

            listeners.forEach(cb => { try { cb('SIGNED_IN', session); } catch (e) { console.error(e) } });
            return { data: { session, user: (session as { user: unknown }).user }, error: null };
          },

          signOut: async () => {
            session = null;
            localStorage.removeItem(MOCK_SESSION_KEY);
            listeners.forEach(cb => cb('SIGNED_OUT', null));
            return { error: null };
          },

          getSession: async () => ({ data: { session }, error: null }),
        },

        from: (table: string) => {
          const queryChain: SupabaseQuery<typeof MOCK_USER_PROFILE | typeof MOCK_SESSIONS[number]> = {
            select: () => queryChain,
            eq: (column, value) => {
              if (table === 'user_profiles' && column === 'id' && value === MOCK_USER_PROFILE.id) {
                return { single: () => Promise.resolve({ data: MOCK_USER_PROFILE, error: null }) };
              }
              if (table === 'sessions' && column === 'user_id' && value === MOCK_USER.id) {
                return {
                  order: () => {
                    const sorted = [...MOCK_SESSIONS].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                    return Promise.resolve({ data: sorted, error: null });
                  },
                };
              }
              return { single: () => Promise.resolve({ data: null, error: { message: 'Not Found', code: '404' } }) };
            },
            order: () => Promise.resolve({ data: [], error: null }),
            single: () => Promise.resolve({ data: table === 'user_profiles' ? MOCK_USER_PROFILE : null, error: null }),
          };
          return queryChain;
        },
      };
    }
  });

  await page.goto('/');
  await page.waitForFunction(() => !document.querySelector('[data-testid="loading-skeleton"]'), { timeout: 15000 });

  const fakeAccessToken = generateFakeJWT();
  const now = Math.floor(Date.now() / 1000);

  await page.evaluate(async ({ token, timestamp }) => {
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
    await (window as { supabase?: { auth: { setSession: (session: unknown) => Promise<void> } } }).supabase?.auth.setSession(fakeSession);
  }, { token: fakeAccessToken, timestamp: now });

  // Wait for the custom event that signals the profile has been loaded
  await page.evaluate(() => new Promise<void>(resolve => {
    document.addEventListener('e2e-profile-loaded', () => resolve());
  }));

  await page.waitForSelector('[data-testid="nav-sign-out-button"]', { timeout: 15000, state: 'visible' });
  await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();
}

/**
 * Capture authenticated and unauthenticated UI states
 */
export async function captureAuthStates(page: Page): Promise<void> {
  const screenshotDir = 'screenshots';
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Sign In' })).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/unauthenticated-home.png`, fullPage: true });

  await programmaticLogin(page);
  await expect(page.getByTestId('app-main')).toBeVisible();
  await page.screenshot({ path: `${screenshotDir}/authenticated-home.png`, fullPage: true });
}
