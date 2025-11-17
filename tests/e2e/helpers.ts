// tests/e2e/helpers.ts
/**
 * This file merges:
 *  - The agent’s architectural fixes
 *  - The original full-feature helpers.ts (transcript, full DB mock, logs)
 *  - Strict ESLint + TS compatibility (no ts-nocheck)
 */

import type { Page } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import {
  MOCK_USER,
  MOCK_USER_PROFILE,
  MOCK_SESSION_KEY,
  MOCK_TRANSCRIPTS,
  MOCK_SESSIONS,
} from './fixtures/mockData';

/* ---------------------------------------------
   Utilities
---------------------------------------------- */

function sortSessionsAscending() {
  return [...MOCK_SESSIONS].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/**
 * Stream console logs into Playwright (original feature)
 */
export function attachLiveTranscript(page: Page): void {
  page.on('console', (msg) => {
    console.log(`[BROWSER ${msg.type().toUpperCase()}] ${msg.text()}`);
  });
}

/* ---------------------------------------------
   Supabase Mock + Programmatic Login
---------------------------------------------- */

export async function programmaticLogin(page: Page): Promise<void> {
  //
  // 1 — Inject Supabase mock **before app boot**
  //
  await page.addInitScript(
    (mockData) => {
      const listeners = new Set<
        (event: string, session: unknown) => void
      >();

      let session: unknown = null;

      const stored = window.localStorage.getItem(mockData.MOCK_SESSION_KEY);
      if (stored) session = JSON.parse(stored);

      const mockSupabase = {
        auth: {
          onAuthStateChange(cb: (event: string, session: unknown) => void) {
            console.log('[E2E MOCK AUTH] Listener added');
            listeners.add(cb);

            // agent's critical fix: synchronous INITIAL_SESSION
            cb('INITIAL_SESSION', session);

            return {
              data: {
                subscription: { unsubscribe: () => listeners.delete(cb) },
              },
            };
          },

          setSession(newSession: unknown) {
            console.log('[E2E MOCK AUTH] setSession called');
            session = newSession;

            window.localStorage.setItem(
              mockData.MOCK_SESSION_KEY,
              JSON.stringify(session)
            );

            // agent’s critical fix: synchronous SIGNED_IN
            listeners.forEach((cb) => cb('SIGNED_IN', session));
          },

          // required by correct Supabase API shape
          getSession() {
            return Promise.resolve({ data: { session }, error: null });
          },

          signOut() {
            session = null;
            listeners.forEach((cb) => cb('SIGNED_OUT', null));
            return Promise.resolve({ data: null, error: null });
          },
        },

        //
        // Database API (merged from original full helpers)
        //
        from(table: string) {
          console.log(`[E2E MOCK DB] from('${table}')`);

          return {
            select: () => ({
              eq: (column: string, value: unknown) => ({
                single: () => {
                  console.log(
                    `[E2E MOCK DB] single() → ${table}.${column}='${value}'`
                  );

                  // user_profiles handler
                  if (
                    table === 'user_profiles' &&
                    column === 'id' &&
                    value === mockData.MOCK_USER.id
                  ) {
                    console.log('[E2E MOCK DB] Returning mock profile');
                    return Promise.resolve({
                      data: mockData.MOCK_USER_PROFILE,
                      error: null,
                    });
                  }

                  return Promise.resolve({
                    data: null,
                    error: { message: 'Not found' },
                  });
                },
              }),

              // sessions table ordering support
              order: (col: string, opts?: { ascending: boolean }) => {
                console.log(
                  `[E2E MOCK DB] order(${col}, ascending=${opts?.ascending})`
                );
                const asc = opts?.ascending ?? true;
                const sorted = sortSessionsAscending();
                return Promise.resolve({
                  data: asc ? sorted : [...sorted].reverse(),
                  error: null,
                });
              },
            }),

            // fallback: single()
            single: () => {
              if (table === 'user_profiles') {
                return Promise.resolve({
                  data: mockData.MOCK_USER_PROFILE,
                  error: null,
                });
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };

      // expose mock
      (window as { supabase?: unknown }).supabase = mockSupabase;
    },
    { MOCK_USER, MOCK_USER_PROFILE, MOCK_SESSION_KEY }
  );

  //
  // 2 — Boot application (mock is already injected)
  //
  await page.goto('/');

  //
  // 3 — Construct session
  //
  const now = Math.floor(Date.now() / 1000);
  const sessionObj: Session = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: MOCK_USER.id,
      email: MOCK_USER.email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
    },
  };

  //
  // 4 — Create promise BEFORE triggering session (agent’s important fix)
  //
  const profileLoaded = page.evaluate(() => {
    return new Promise<void>((resolve) => {
      console.log('[E2E PAGE] Waiting for e2e-profile-loaded…');

      const handler = () => {
        console.log('[E2E PAGE] profile loaded event received');
        document.removeEventListener('e2e-profile-loaded', handler);
        resolve();
      };

      document.addEventListener('e2e-profile-loaded', handler);

      // fallback if app flags pre-loaded state
      if ((window as { __E2E_PROFILE_LOADED__?: boolean }).__E2E_PROFILE_LOADED__) resolve();
    });
  });

  //
  // 5 — Trigger SIGNED_IN flow
  //
  await page.evaluate(
    (session) => {
      console.log('[E2E PAGE] Calling setSession()');
      (window as { supabase?: { auth: { setSession: (session: unknown) => void } } }).supabase?.auth.setSession(session);
    },
    sessionObj
  );

  //
  // 6 — Wait for full auth resolution
  //
  await profileLoaded;
}

/* ---------------------------------------------
   Transcript simulation (original feature)
---------------------------------------------- */
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

/* ---------------------------------------------
   Screenshot helper
---------------------------------------------- */

export async function capturePage(
  page: Page,
  filename: string,
  authState: 'unauth' | 'auth' = 'unauth'
): Promise<void> {
  const selector =
    authState === 'unauth'
      ? 'a:has-text("Sign In")'
      : '[data-testid="nav-sign-out-button"]';

  await page.waitForSelector(selector, {
    state: 'visible',
    timeout: 20000,
  });

  await page.waitForTimeout(200);

  await page.screenshot({
    path: `screenshots/${filename}`,
    fullPage: true,
  });

  console.log(`[E2E CAPTURE] Saved to screenshots/${filename}`);
}
