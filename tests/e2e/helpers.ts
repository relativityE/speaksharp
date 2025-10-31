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
  // FIX #1: Inject mock Supabase client inline (not from external file)
  console.log('[HealthCheck:Start] Beginning programmatic login.');
  await page.addInitScript(() => {
    (window as { TEST_MODE?: boolean }).TEST_MODE = true;
    (window as { __E2E_MODE__?: boolean }).__E2E_MODE__ = true;
    (window as { authReady?: Promise<void> }).authReady = new Promise(resolve => {
      (window as { authReadyResolve?: (value: void | PromiseLike<void>) => void }).authReadyResolve = resolve;
    });

    // Create inline mock Supabase client
    if (!(window as { __MOCK_SUPABASE_CLIENT_INITIALIZED__?: boolean }).__MOCK_SUPABASE_CLIENT_INITIALIZED__) {
      (window as { __MOCK_SUPABASE_CLIENT_INITIALIZED__?: boolean }).__MOCK_SUPABASE_CLIENT_INITIALIZED__ = true;

      console.log('[HealthCheck:MockInject] Injecting mock Supabase client.');
      const MOCK_SESSION_KEY = 'sb-mock-session';
      let session: unknown = null;
      try {
        const storedSession = localStorage.getItem(MOCK_SESSION_KEY);
        if (storedSession) {
          console.log('[HealthCheck:MockRead] Session found in localStorage.');
          session = JSON.parse(storedSession);
        } else {
          console.log(
            '[HealthCheck:MockRead] No session in localStorage.',
          );
        }
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
              data: {
                subscription: {
                  unsubscribe: () => listeners.delete(callback)
                }
              },
            };
          },

          setSession: async (sessionData: unknown) => {
            session = {
              ...(sessionData as Record<string, unknown>),
              expires_at: Math.floor(Date.now() / 1000) + 3600
            };

            try {
              localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(session));
              console.log('[HealthCheck:MockWrite] Session saved to localStorage.');
            } catch (e) {
              console.error('[MockClient] Failed to save session to localStorage:', e);
            }

            listeners.forEach(listener => {
              try {
                listener('SIGNED_IN', session);
              } catch (e) {
                console.error('[MockAuth] Listener error:', e);
              }
            });

            return { data: { session, user: (session as { user: unknown }).user }, error: null };
          },

          signOut: async () => {
            session = null;
            localStorage.removeItem(MOCK_SESSION_KEY);
            listeners.forEach(listener => listener('SIGNED_OUT', null));
            return { error: null };
          },

          getSession: async () => {
            return { data: { session }, error: null };
          },
        },

from: (table: string) => {
  const mockUserProfile = {
    id: 'test-user-123',
    email: 'test@example.com',
    subscription_status: 'pro',
    preferred_mode: 'cloud',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const mockSessions = [
    {
      id: 'session-1',
      user_id: 'test-user-123',
      created_at: new Date(Date.now() - 86400000).toISOString(),
      duration: 300,
      word_count: 750,
      filler_word_count: 15,
      average_pace: 150,
      clarity_score: 85,
      confidence_score: 78,
    },
    {
      id: 'session-2',
      user_id: 'test-user-123',
      created_at: new Date(Date.now() - 172800000).toISOString(),
      duration: 420,
      word_count: 1050,
      filler_word_count: 12,
      average_pace: 150,
      clarity_score: 88,
      confidence_score: 82,
    },
    {
      id: 'session-3',
      user_id: 'test-user-123',
      created_at: new Date(Date.now() - 259200000).toISOString(),
      duration: 360,
      word_count: 900,
      filler_word_count: 10,
      average_pace: 150,
      clarity_score: 90,
      confidence_score: 85,
    },
  ];

  return {
    select: () => {
      return {
        eq: (column: string, value: unknown) => {
          if (table === 'user_profiles' && column === 'id' && value === mockUserProfile.id) {
            return {
              single: () => Promise.resolve({
                data: mockUserProfile,
                error: null
              }),
            };
          }

          if (table === 'sessions') {
            return {
          order: (col: string, opts: { ascending: boolean }) => {
                const sorted = [...mockSessions].sort((a, b) => {
                  if (opts.ascending) {
                    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                  }
                  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                });
                return Promise.resolve({ data: sorted, error: null });
              },
            };
          }

          return Promise.resolve({ data: [], error: null });
        },

        order: (col: string, opts: { ascending: boolean }) => {
          if (table === 'sessions') {
            const sorted = [...mockSessions].sort((a, b) => {
              if (opts.ascending) {
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
              }
              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });
            return Promise.resolve({ data: sorted, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },

        single: () => {
          if (table === 'user_profiles') {
            return Promise.resolve({
              data: mockUserProfile,
              error: null
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
},
      };

      console.log('[MockClient] Supabase mock initialized inline');
    }
  });

  console.log('[HealthCheck:Navigate] Navigating to root "/".');
  await page.goto('/');
  console.log('[HealthCheck:Navigate] ✅ Page loaded');

  // Wait for supabase client to be available
  await page.waitForFunction(() => (window as { supabase?: unknown }).supabase, { timeout: 10000 });
  console.log('[HealthCheck:Navigate] ✅ Supabase client ready');

  // Wait for initial app mount (loading skeleton disappears)
  await page.waitForFunction(
    () => {
      const loadingSkeleton = document.querySelector('[data-testid="loading-skeleton"]');
      return !loadingSkeleton;
    },
    { timeout: 15000 }
  );
  console.log('✅ App initialized');

  const fakeAccessToken = generateFakeJWT();
  const now = Math.floor(Date.now() / 1000);

  // Set mock profile BEFORE session
  await page.evaluate(() => {
    (window as { __E2E_MOCK_PROFILE__?: unknown }).__E2E_MOCK_PROFILE__ = {
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

      console.log('[HealthCheck:Inject] Setting session...');
      const mockSupabase = (window as { supabase?: { auth: { setSession: (session: unknown) => Promise<unknown> } } }).supabase;
      if (mockSupabase) {
        const result = await mockSupabase.auth.setSession(fakeSession);
        console.log('[HealthCheck:Inject] Session set result:', result);
      }
    },
    { token: fakeAccessToken, timestamp: now }
  );
  console.log('[HealthCheck:Inject] ✅ Session injected');

  // Wait for profile to load
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('__E2E_SESSION_INJECTED__'));
  });

  await page.waitForFunction(() => (window as { authReady?: Promise<void> }).authReady && (window as { __E2E_PROFILE_LOADED__?: boolean }).__E2E_PROFILE_LOADED__, { timeout: 15000 });

  // Wait for authenticated UI (sign-out button)
  await page.waitForSelector('[data-testid="nav-sign-out-button"]', {
    timeout: 15000,
    state: 'visible'
  });

  await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();
  console.log('[HealthCheck:End] ✅ Login complete');
}
