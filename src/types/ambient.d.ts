// src/types/ambient.d.ts

/**
 * This file is for global type definitions that are not tied to a specific module.
 * It's particularly useful for extending built-in browser types like `Window`.
 *
 * For this to work, ensure this file is included in your tsconfig.json's "include" array.
 * By default, Vite's tsconfig includes "src", so this should be picked up automatically.
 */

declare global {
  interface Window {
    /**
     * Flag used by Mock Service Worker (MSW) to indicate when it's ready to handle requests.
     * E2E tests should wait for this flag to be `true` before proceeding.
     */
    mswReady?: boolean;

    /**
     * An array to capture console.error messages during E2E tests.
     * This is populated by a script injected via Playwright's `addInitScript`.
     */
    __E2E_CONSOLE_ERRORS__?: string[];

    /**
     * A flag set by the AuthProvider to signal that the user profile has been fetched
     * and the auth context is fully initialized. E2E tests can wait for this to be `true`
     * to ensure the application is in a stable, post-login state.
     */
    __E2E_PROFILE_LOADED__?: boolean;
  }
}

// This export is necessary to make the file a module.
export { };
