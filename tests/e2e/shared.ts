import { Page } from '@playwright/test';
import { programmaticLogin, defaultTestUserProfile } from './helpers';

/**
 * A reusable health-check function that verifies the core login flow.
 * It uses the default 'free' user profile.
 * @param page The Playwright Page object.
 */
export async function healthCheck(page: Page) {
  // Use the refactored programmaticLogin with the default user profile.
  // This function now handles setting the mock profile and session correctly.
  await programmaticLogin(page, defaultTestUserProfile);

  // The assertions for a successful login are already inside programmaticLogin,
  // so we don't need to repeat them here. This function serves as a clear,
  // reusable entry point for tests that need a basic logged-in state.
}
