// @ts-nocheck
// tests/e2e/helpers.ts
/**
 * NOTE: This file contains extensive console logging (`[E2E MOCK]`, `[E2E PAGE]`, etc.).
 * These logs were essential for debugging a series of complex, interdependent race
 * conditions and should be preserved. For a quieter test run, they can be conditionally
 * disabled by wrapping them in a check against an environment variable, e.g.:
 * `if (process.env.E2E_VERBOSE) console.log(...)`
 */
import type { Page } from '@playwright/test';
import type { Session } from '@supabase/supabase-js';
import { MOCK_USER, MOCK_USER_PROFILE, MOCK_SESSION_KEY } from './fixtures/mockData';

/**
 * Programmatic login helper (ARCHITECTURAL FIX):
 * - Injects a pure JS mock of the Supabase client via addInitScript.
 * - Passes mock data into the script context to avoid hardcoding.
 * - Navigates to the page, which now boots with the mock.
 * - Triggers the mock's auth flow.
 * - Waits for the deterministic handshake event from the app.
 */
export async function programmaticLogin(page: Page): Promise<void> {
  // 1. Inject a pure JavaScript mock of the Supabase client.
  // This script runs BEFORE any app code. It must not contain any TypeScript syntax.
  await page.addInitScript((mockData) => {
    // @ts-expect-error - JSDoc types are not being picked up in this context
    const listeners = new Set();
    // @ts-expect-error - JSDoc types are not being picked up in this context
    let session = null;
    const storedSession = window.localStorage.getItem(mockData.MOCK_SESSION_KEY);
    if (storedSession) {
      session = JSON.parse(storedSession);
    }

    const mockSupabase = {
      auth: {
        // @ts-expect-error - JSDoc types are not being picked up in this context
        onAuthStateChange: (callback) => {
          console.log('[E2E MOCK AUTH] A new listener has subscribed.');
          listeners.add(callback);
          // CRITICAL: Synchronously notify the listener of the initial state
          console.log('[E2E MOCK AUTH] Synchronously dispatching INITIAL_SESSION event.');
          callback('INITIAL_SESSION', session);
          return {
            data: { subscription: { unsubscribe: () => listeners.delete(callback) } },
          };
        },
        // @ts-expect-error - JSDoc types are not being picked up in this context
        setSession: (newSession) => {
          console.log('[E2E MOCK AUTH] setSession called.');
          session = newSession;
          window.localStorage.setItem(mockData.MOCK_SESSION_KEY, JSON.stringify(session));
          console.log('[E2E MOCK AUTH] Synchronously dispatching SIGNED_IN event.');
          // @ts-expect-error - JSDoc types are not being picked up in this context
          listeners.forEach((listener) => listener('SIGNED_IN', session));
        },
      },
      // @ts-expect-error - JSDoc types are not being picked up in this context
      from: (tableName) => {
        console.log(`[E2E MOCK DB] from('${tableName}') called.`);
        return {
          select: () => ({
            // @ts-expect-error - JSDoc types are not being picked up in this context
            eq: (column, value) => ({
              single: () => {
                console.log(`[E2E MOCK DB] single() called for ${tableName}.${column}='${value}'`);
                if (tableName === 'user_profiles' && column === 'id' && value === mockData.MOCK_USER.id) {
                  console.log('[E2E MOCK DB] Matched profile query. Returning mock profile.');
                  return Promise.resolve({ data: mockData.MOCK_USER_PROFILE, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Not found' } });
              },
            }),
          }),
        };
      },
    };
    // @ts-expect-error - attaching to window for test purposes
    window.supabase = mockSupabase;
  }, { MOCK_USER, MOCK_USER_PROFILE, MOCK_SESSION_KEY }); // Pass mock data into the browser context

  // 2. Navigate to the app. It will now boot up using our injected mock client.
  await page.goto('/');

  // 3. Create a fake session object that is consistent with the mock data.
  const now = Math.floor(Date.now() / 1000);
  const fakeSession = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: MOCK_USER.id, // CRITICAL: This ID must match the one in MOCK_USER_PROFILE
      email: MOCK_USER.email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '',
      updated_at: '',
    },
  };

  // 4. Set up the event listener BEFORE triggering the action that will cause the event.
  const profileLoadedPromise = page.evaluate(() =>
    new Promise<void>((resolve) => {
      console.log('[E2E PAGE] Attaching listener for e2e-profile-loaded event...');
      document.addEventListener('e2e-profile-loaded', () => {
        console.log('[E2E PAGE] Received e2e-profile-loaded. Test can proceed.');
        resolve();
      });
    })
  );

  // 5. Now, trigger the auth flow inside the app by calling the mock's setSession.
  await page.evaluate((session) => {
    console.log('[E2E PAGE] Triggering setSession on mock client.');
    // @ts-expect-error - window.supabase is our mock
    window.supabase.auth.setSession(session);
  }, fakeSession as unknown as Session);

  // 6. Wait for the promise to resolve.
  await profileLoadedPromise;
}

export async function capturePage(page: Page, filename: string, authState: 'unauth' | 'auth' = 'unauth'): Promise<void> {
  // Wait for a stable, user-visible element that indicates the UI is settled.
  const selector = authState === 'unauth'
    ? 'a:has-text("Sign In")'
    : '[data-testid="nav-sign-out-button"]';
  await page.waitForSelector(selector, { state: 'visible', timeout: 20000 });

  // Optional: A small delay to ensure CSS animations have finished, though waitForSelector should be sufficient.
  await page.waitForTimeout(250);

  await page.screenshot({ path: `screenshots/${filename}`, fullPage: true });
  console.log(`[E2E CAPTURE] Screenshot saved to screenshots/${filename}`);
}
