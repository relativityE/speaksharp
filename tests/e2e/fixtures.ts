import { test as base, Page } from '@playwright/test';
import { programmaticLoginWithRoutes } from './helpers';
import { setupE2EMocks } from './mock-routes';

/**
 * Playwright Fixtures for SpeakSharp
 * Separation of concerns between Shared (Worker) and Isolated (Test)
 */

type TestFixtures = {
  userPage: Page;         // Full readiness (Analytics + Core)
  proPage: Page;          // Full readiness (Analytics + Core)
  leanUserPage: Page;     // Lean readiness (Core only)
  emptyUserPage: Page;
  freePage: Page;
  mockedPage: Page;
};

type WorkerFixtures = {
  workerAuth: void;
};

/**
 * The shared console monitor's rule: console errors that are expected, non-fatal noise (network, STT, trial, RPC,
 * heartbeat and profile). Every other console error fails the test. Exported so a spec that must also allow its own
 * exact, injected diagnostics can keep this same rule for everything else.
 */
const NON_FATAL_CONSOLE_MARKERS = [
  'NET::ERR_', 'FAILED TO LOAD RESOURCE', '404', '500', 'FETCH', 'TRANSCRIPTION ERROR', 'TRANSCRIPTIONSERVICE',
  'ENSUREENGINEINITIALIZED', 'NETWORK_TIMEOUT', 'ABORT', 'TRIAL', 'RPC', 'HEARTBEAT', 'PROFILE', 'USERPROFILE',
  'FAILED_VISIBLE', 'DISTRIBUTEDLOCK',
] as const;

export function isNonFatalConsoleError(text: string): boolean {
  const upperText = text.toUpperCase();
  return NON_FATAL_CONSOLE_MARKERS.some((marker) => upperText.includes(marker));
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker-scoped setup (Placeholder for shared boot/env if needed)
  workerAuth: [async ({ playwright }, use) => {
    void playwright;
    await use();
  }, { scope: 'worker' }],

  // 🛡️ [Fix 5.1/5.2] Test Harness Isolation (Singleton + Storage)
  // v0.6.1 Hardening: Move isolation logic to the base 'page' fixture
  // to ensure it executes BEFORE auth-scoped fixtures (like userPage).
  page: async ({ page }, use) => {
    await page.route(/\/rest\/v1\/rpc\/heartbeat_session(\?.*)?$/, route => route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success: true })
    }));

    await page.addInitScript(() => {
      const win = window as Window & { __SS_E2E_STORAGE_ISOLATED_ONCE__?: boolean };
      if (win.__SS_E2E_STORAGE_ISOLATED_ONCE__) return;
      win.__SS_E2E_STORAGE_ISOLATED_ONCE__ = true;

      Object.keys(localStorage)
        .filter(k => k.startsWith('sb-'))
        .forEach(k => localStorage.removeItem(k));
    });

    // Attach Global Monitors (Console/Errors) before the spec-owned first app load.
    // Do not boot the app here: route/auth fixtures must install their contracts
    // first, or profile hydration can race ahead of the mock routes.
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isNetworkError = isNonFatalConsoleError(text);

        if (isNetworkError) {
          console.warn(`[E2E_NON_FATAL_LOG] ${text}`);
        } else {
          throw new Error(`[E2E_FATAL_CONSOLE_ERROR] ${text}`);
        }
      }
    });
    page.on('pageerror', error => {
      throw error;
    });

    await use(page);
  },

  mockedPage: async ({ page }, use) => {
    await setupE2EMocks(page);
    await use(page);
  },

  userPage: async ({ page }, use) => {
    await programmaticLoginWithRoutes(page);
    await use(page);
  },

  proPage: async ({ page }, use) => {
    await page.route('**/rest/v1/user_profiles*', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'mock-pro-id',
          subscription_status: 'pro',
          usage_seconds: 0,
          usage_reset_date: new Date(Date.now() + 30 * 86400000).toISOString(),
          created_at: new Date().toISOString()
        })
      });
    });

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await use(page);
  },

  leanUserPage: async ({ page }, use) => {
    await programmaticLoginWithRoutes(page);
    await use(page);
  },

  emptyUserPage: async ({ page }, use) => {
    await programmaticLoginWithRoutes(page, { emptySessions: true });
    await use(page);
  },

  freePage: async ({ page }, use) => {
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await use(page);
  }
});


export { expect } from '@playwright/test';
