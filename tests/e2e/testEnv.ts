// tests/e2e/testEnv.ts
import { test as base } from '@playwright/test';

// Extend the base test fixture to include our custom setup.
export const test = base.extend({
  // The 'page' fixture is overridden here.
  page: async ({ page }, use) => {
    // Add an initialization script to the page.
    // This script will run before any scripts on the page.
    await page.addInitScript(() => {
      // These flags are used by the application to enable test-specific behavior,
      // such as mocking APIs or exposing helper functions.
      (window as any).TEST_MODE = true;
      (window as any).__E2E_MODE__ = true;
    });

    // The 'use' function passes the modified 'page' fixture to the test.
    await use(page);
  },
});

// Re-export 'expect' from the base test module for convenience.
export { expect } from '@playwright/test';
