import { Page, expect } from '@playwright/test';

export const consoleLogger = (page: Page) => {
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    console.log(`[BROWSER ${type.toUpperCase()}]`, text);
  });
};

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
  console.log('[HealthCheck] Starting programmatic login...');

  // Enable console logging
  consoleLogger(page);

  // Inject mock Supabase client BEFORE navigation
  await page.addInitScript(() => {
    console.log('[MockInit] Initializing mock Supabase client...');

    if (!(window as { __MOCK_SUPABASE_CLIENT_INITIALIZED__?: boolean }).__MOCK_SUPABASE_CLIENT_INITIALIZED__) {
      (window as { __MOCK_SUPABASE_CLIENT_INITIALIZED__?: boolean }).__MOCK_SUPABASE_CLIENT_INITIALIZED__ = true;

      const MOCK_SESSION_KEY = 'sb-mock-session';
      let session: unknown = null;

      try {
        const storedSession = localStorage.getItem(MOCK_SESSION_KEY);
        if (storedSession) {
          console.log('[MockClient] Found existing session in localStorage');
          session = JSON.parse(storedSession);
        } else {
          console.log('[MockClient] No existing session in localStorage');
        }
      } catch (e) {
        console.error('[MockClient] Failed to parse stored session:', e);
        localStorage.removeItem(MOCK_SESSION_KEY);
      }

      const listeners = new Set<(event: string, session: unknown | null) => void>();

      (window as { supabase?: unknown }).supabase = {
        auth: {
          onAuthStateChange: (callback: (event: string, session: unknown | null) => void) => {
            console.log('[MockAuth] onAuthStateChange registered, listeners:', listeners.size);
            listeners.add(callback);
            setTimeout(() => {
              console.log('[MockAuth] Firing INITIAL_SESSION, has session:', !!session);
              callback('INITIAL_SESSION', session);
            }, 0);
            return {
              data: {
                subscription: {
                  unsubscribe: () => {
                    console.log('[MockAuth] Unsubscribe called');
                    listeners.delete(callback);
                  }
                }
              },
            };
          },

          setSession: async (sessionData: unknown) => {
            console.log('[MockAuth] setSession called');
            session = {
              ...(sessionData as Record<string, unknown>),
              expires_at: Math.floor(Date.now() / 1000) + 3600
            };

            try {
              localStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(session));
              console.log('[MockAuth] Session saved to localStorage');
            } catch (e) {
              console.error('[MockClient] Failed to save session to localStorage:', e);
            }

            console.log('[MockAuth] Notifying', listeners.size, 'listeners of SIGNED_IN');
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
            console.log('[MockAuth] signOut called');
            session = null;
            localStorage.removeItem(MOCK_SESSION_KEY);
            listeners.forEach(listener => listener('SIGNED_OUT', null));
            return { error: null };
          },

          getSession: async () => {
            console.log('[MockAuth] getSession called, has session:', !!session);
            return { data: { session }, error: null };
          },
        },

        from: (table: string) => {
          console.log('[MockDB] from() called with table:', table);

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
                      single: () => {
                        console.log('[MockDB] Returning user profile');
                        return Promise.resolve({
                          data: mockUserProfile,
                          error: null
                        });
                      },
                    };
                  }

                  if (table === 'sessions') {
                    return {
                      order: (col: string, opts: { ascending: boolean }) => {
                        console.log('[MockDB] Returning ordered sessions');
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
                    console.log('[MockDB] Returning ordered sessions (direct)');
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
                    console.log('[MockDB] Returning user profile (direct single)');
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

      console.log('[MockClient] ✅ Supabase mock initialized');
    }
  });

  console.log('[HealthCheck] Navigating to /');
  await page.goto('/');
  console.log('[HealthCheck] Page loaded');

  // Wait for initial app mount (loading skeleton disappears)
  console.log('[HealthCheck] Waiting for app to initialize...');
  await page.waitForFunction(
    () => {
      const loadingSkeleton = document.querySelector('[data-testid="loading-skeleton"]');
      return !loadingSkeleton;
    },
    { timeout: 15000 }
  );
  console.log('[HealthCheck] ✅ App initialized');

  const fakeAccessToken = generateFakeJWT();
  const now = Math.floor(Date.now() / 1000);

  // FIX: Set up listener AND trigger session in SAME evaluate call
  console.log('[HealthCheck] Setting session and waiting for profile load...');
  const profileLoaded = await page.evaluate(
    async ({ token, timestamp }) => {
      console.log('[E2E] Setting up profile-loaded listener...');

      // Set up the event listener FIRST
      const profileLoadedPromise = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          console.error('[E2E] ⏱️ Timeout waiting for profile-loaded event (15s)');
          resolve(false);
        }, 15000);

        document.addEventListener('e2e-profile-loaded', () => {
          console.log('[E2E] ✅ profile-loaded event received!');
          clearTimeout(timeout);
          resolve(true);
        }, { once: true });
      });

      // NOW trigger the session
      console.log('[E2E] Setting session...');
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

      const mockSupabase = (window as { supabase?: { auth: { setSession: (session: unknown) => Promise<unknown> } } }).supabase;
      if (mockSupabase) {
        await mockSupabase.auth.setSession(fakeSession);
        console.log('[E2E] Session set, waiting for profile...');
      } else {
        console.error('[E2E] ❌ No supabase client found!');
        return false;
      }

      // Wait for the event
      return await profileLoadedPromise;
    },
    { token: fakeAccessToken, timestamp: now }
  );

  if (!profileLoaded) {
    console.error('[HealthCheck] ❌ Profile failed to load!');
    throw new Error('Profile loading timeout - e2e-profile-loaded event never fired');
  }
  console.log('[HealthCheck] ✅ Profile loaded successfully');

  // Wait for authenticated UI (sign-out button)
  console.log('[HealthCheck] Waiting for sign-out button...');
  await page.waitForSelector('[data-testid="nav-sign-out-button"]', {
    timeout: 15000,
    state: 'visible'
  });

  await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();
  console.log('[HealthCheck] ✅ Login complete - sign-out button visible');
}
