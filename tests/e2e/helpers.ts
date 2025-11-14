// tests/e2e/helpers.ts
import type { Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  MOCK_USER,
  MOCK_SESSION_KEY,
} from './fixtures/mockData';

/**
 * Programmatic login helper:
 * - Injects a real Supabase client onto window.__INJECTED_SUPABASE__
 * - Writes a fake session to localStorage
 * - Waits for the app to dispatch 'e2e-profile-loaded'
 */
export async function programmaticLogin(page: Page): Promise<void> {
  // Inject a real Supabase client into the page prior to app code reading it
  await page.addInitScript(({ supabaseUrl, supabaseKey }) => {
    // @ts-expect-error - test injection
    window.__INJECTED_SUPABASE__ = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
      },
    });
  }, {
    supabaseUrl: process.env.VITE_SUPABASE_URL!,
    supabaseKey: process.env.VITE_SUPABASE_ANON_KEY!,
  });

  // Navigate to root (app will mount and read injected client)
  await page.goto('/');

  // Wait for app initial mount to finish (loading skeleton disappears)
  await page.waitForFunction(() => !document.querySelector('[data-testid="loading-skeleton"]'), { timeout: 15000 });

  // Create a fake session object and push it through the mock auth
  const now = Math.floor(Date.now() / 1000);
  const fakeSession = {
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
      app_metadata: MOCK_USER.app_metadata,
      user_metadata: MOCK_USER.user_metadata,
      created_at: MOCK_USER.created_at,
      updated_at: MOCK_USER.updated_at,
    },
  };

  // Use the injected mock client's setSession via page.evaluate
  await page.evaluate(async ({ key, sessionObj }) => {
    // store in localStorage too (some code reads session there)
    window.localStorage.setItem(key, JSON.stringify(sessionObj));
    // call the injected client's setSession
    // @ts-expect-error - injected test client
    await (window.__INJECTED_SUPABASE__ as any).auth.setSession(sessionObj);
  }, { key: MOCK_SESSION_KEY, sessionObj: fakeSession });

  // Wait for the app to dispatch a custom event that indicates profile loaded
  await page.evaluate(() =>
    new Promise<void>((resolve) => {
      const handler = (): void => {
        document.removeEventListener('e2e-profile-loaded', handler);
        resolve();
      };
      document.addEventListener('e2e-profile-loaded', handler);
      // fallback: resolve if window flag appears
      if ((window as any).__E2E_PROFILE_LOADED__) {
        resolve();
      }
    })
  );
}

export async function capturePage(page: Page, filename: string, authState: 'unauth' | 'auth' = 'unauth'): Promise<void> {
  const selector = authState === 'unauth' ? 'a:has-text("Sign In")' : '[data-testid="nav-sign-out-button"]';
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.screenshot({ path: `screenshots/${filename}`, fullPage: true });
}
