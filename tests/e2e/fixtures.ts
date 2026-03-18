import { test as base, Page } from '@playwright/test';
import { programmaticLoginWithRoutes } from './helpers';
import { setupE2EMocks } from './mock-routes';

/**
 * Playwright Fixtures for SpeakSharp
 * Separation of concerns between Shared (Worker) and Isolated (Test)
 */

type TestFixtures = {
  userPage: Page;
  proPage: Page;
  emptyUserPage: Page;
  freePage: Page;
  mockedPage: Page;
};

type WorkerFixtures = {
  workerAuth: void;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker-scoped setup (Placeholder for shared boot/env if needed)
  workerAuth: [async ({}, use) => {
    await use();
  }, { scope: 'worker' }],

  // Isolated per-test mocked page
  mockedPage: async ({ page }, use) => {
    await setupE2EMocks(page);
    await use(page);
  },

  // Isolated per-test authenticated pages
  userPage: async ({ page }, use) => {
    await programmaticLoginWithRoutes(page, { needsAnalytics: true });
    await use(page);
  },

  proPage: async ({ page }, use) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro', needsAnalytics: true });
    await use(page);
  },

  emptyUserPage: async ({ page }, use) => {
    await programmaticLoginWithRoutes(page, { emptySessions: true, needsAnalytics: true });
    await use(page);
  },

  freePage: async ({ page }, use) => {
    await programmaticLoginWithRoutes(page, { userType: 'free', needsAnalytics: true });
    await use(page);
  }
});

export { expect } from '@playwright/test';
