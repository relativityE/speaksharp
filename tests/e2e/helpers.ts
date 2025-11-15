// tests/e2e/helpers.ts
import type { Page } from '@playwright/test';
import {
  MOCK_USER,
  MOCK_USER_PROFILE,
  MOCK_SESSIONS,
  MOCK_TRANSCRIPTS,
  MOCK_SESSION_KEY,
} from './fixtures/mockData';

// Utility to sort sessions like real Supabase queries
function sortSessionsAscending() {
  return [...MOCK_SESSIONS].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/**
 * Programmatic login helper:
 * - Injects a Supabase v2-compatible mock client
 * - Simulates onAuthStateChange and setSession events
 * - Supports: from().select().eq().single(), sessions ordering, etc.
 * - Waits for AuthProvider to dispatch e2e-profile-loaded
 */
export async function programmaticLogin(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Runs inside browser context
    function makeMockClient() {
      let session: Record<string, unknown> | null = null;
      try {
        const storedSession = window.localStorage.getItem('sb-mock-session');
        if (storedSession) {
          session = JSON.parse(storedSession);
        }
      } catch (e) {
        console.error('[E2E Mock] Could not parse stored session.', e);
        session = null;
      }

      const listeners = new Set<
        (event: string, s: Record<string, unknown> | null) => void
      >();

      const auth = {
        onAuthStateChange(
          callback: (event: string, s: Record<string, unknown> | null) => void
        ) {
          listeners.add(callback);
          setTimeout(() => callback('INITIAL_SESSION', session), 0);

          return {
            data: {
              subscription: {
                unsubscribe: () => listeners.delete(callback),
              },
            },
          };
        },

        async setSession(s: Record<string, unknown>) {
          session = { ...s };
          listeners.forEach((cb) => cb('SIGNED_IN', session));
          return {
            data: {
              session,
              user: (session as { user: unknown }).user,
            },
            error: null,
          };
        },

        async signOut() {
          session = null;
          listeners.forEach((cb) => cb('SIGNED_OUT', null));
          return { data: null, error: null };
        },

        async getSession() {
          return { data: { session }, error: null };
        },
      };

      function from(table: string) {
        return {
          select() {
            return this;
          },

          eq(column: string, value: unknown) {
            if (table === 'user_profiles') {
              if (column === 'id' && value === MOCK_USER_PROFILE.id) {
                return {
                  single: async () => ({
                    data: MOCK_USER_PROFILE,
                    error: null,
                  }),
                };
              }
              return {
                single: async () => ({
                  data: null,
                  error: { message: 'not found' },
                }),
              };
            }

            if (table === 'sessions') {
              return {
                order: async (_col: string, opts?: { ascending: boolean }) => {
                  const asc = opts?.ascending ?? true;
                  const sorted = sortSessionsAscending();
                  return {
                    data: asc ? sorted : [...sorted].reverse(),
                    error: null,
                  };
                },
              };
            }

            return {
              single: async () => ({ data: null, error: null }),
            };
          },

          order(_col: string, opts?: { ascending: boolean }) {
            if (table === 'sessions') {
              const asc = opts?.ascending ?? true;
              const sorted = sortSessionsAscending();
              return Promise.resolve({
                data: asc ? sorted : [...sorted].reverse(),
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          },

          async single() {
            if (table === 'user_profiles') {
              return { data: MOCK_USER_PROFILE, error: null };
            }
            return { data: null, error: null };
          },
        };
      }

      return { auth, from };
    }

    (window as any).__INJECTED_SUPABASE__ = makeMockClient();
  });

  await page.goto('/');

  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="loading-skeleton"]'),
    { timeout: 15000 }
  );

  const now = Math.floor(Date.now() / 1000);

  const sessionObj = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: { ...MOCK_USER },
  };

  await page.evaluate(
    ({ key, sessionObj: s }) => {
      window.localStorage.setItem(key, JSON.stringify(s));
      void (window.__INJECTED_SUPABASE__ as {
        auth: { setSession: (x: unknown) => void };
      }).auth.setSession(s);
    },
    { key: MOCK_SESSION_KEY, sessionObj }
  );

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const handler = () => {
          document.removeEventListener('e2e-profile-loaded', handler);
          resolve();
        };
        document.addEventListener('e2e-profile-loaded', handler);

        if ((window as { __E2E_PROFILE_LOADED__?: boolean })
          .__E2E_PROFILE_LOADED__) {
          resolve();
        }
      })
  );
}

/**
 * Append mock transcript lines in the DOM
 */
export async function mockLiveTranscript(
  page: Page,
  lines: readonly string[] = MOCK_TRANSCRIPTS,
  delayMs = 200
): Promise<void> {
  for (const line of lines) {
    await page.evaluate((text) => {
      const panel = document.querySelector(
        '[data-testid="transcript-display"]'
      );
      if (panel) {
        const div = document.createElement('div');
        div.textContent = text;
        panel.appendChild(div);
      }
    }, line);

    await page.waitForTimeout(delayMs);
  }
}

/**
 * Capture screenshot for stateful UI snapshots
 */
export async function capturePage(
  page: Page,
  filename: string,
  authState: 'unauth' | 'auth' = 'unauth'
): Promise<void> {
  const selector =
    authState === 'unauth'
      ? 'a:has-text("Sign In")'
      : '[data-testid="nav-sign-out-button"]';

  await page.waitForSelector(selector, { timeout: 20000 });

  await page.screenshot({
    path: `screenshots/${filename}`,
    fullPage: true,
  });
}
