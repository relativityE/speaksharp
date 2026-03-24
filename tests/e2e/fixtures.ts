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

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker-scoped setup (Placeholder for shared boot/env if needed)
  workerAuth: [async ({ playwright }, use) => {
    void playwright;
    await use();
  }, { scope: 'worker' }],

  // Fail tests on console errors or unhandled exceptions (CI Hard-Gate)
  page: async ({ page }, use) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const upperText = text.toUpperCase();

        // Identify expected non-fatal network/STT errors
        const isNetworkError = upperText.includes('NET::ERR_') || 
                              upperText.includes('FAILED TO LOAD RESOURCE') ||
                              upperText.includes('404') ||
                              upperText.includes('500') ||
                              upperText.includes('FETCH') ||
                              upperText.includes('TRANSCRIPTION ERROR') ||
                              upperText.includes('TRANSCRIPTIONSERVICE') ||
                              upperText.includes('ENSUREENGINEINITIALIZED') ||
                              upperText.includes('NETWORK_TIMEOUT') ||
                              upperText.includes('ABORT') ||
                              upperText.includes('PROMO') ||
                              upperText.includes('RPC') ||
                              upperText.includes('FAILED_VISIBLE') ||
                              upperText.includes('DISTRIBUTEDLOCK');

        if (isNetworkError) {
          console.warn(`[E2E_NON_FATAL_LOG] ${text}`);
        } else {
          // Throw for legitimate application errors (React crashes, etc)
          throw new Error(`[E2E_FATAL_CONSOLE_ERROR] ${text}`);
        }
      }
    });
    page.on('pageerror', error => {
      throw error;
    });
    await use(page);
  },

  // Isolated per-test mocked page
  mockedPage: async ({ page }, use) => {
    await setupE2EMocks(page);
    await use(page);
  },

  // Isolated per-test authenticated pages
  // These are now lean by default because 'READY' handles hydration.
  userPage: async ({ page }, use) => {
    await programmaticLoginWithRoutes(page);
    await use(page);
  },

  proPage: async ({ page }, use) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await use(page);
  },

  // Fixture alias for clarity in speed-sensitive tests
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
