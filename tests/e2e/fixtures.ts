/**
 * E2E Test Fixtures
 * 
 * Provides extended Playwright test fixtures for consistent test setup.
 * 
 * ## Usage
 * 
 * ```ts
 * import { test } from './fixtures';
 * 
 * test('my test', async ({ mockedPage }) => {
 *   // mockedPage has all Supabase mocks pre-configured
 *   await mockedPage.goto('/');
 * });
 * ```
 * 
 * @see https://playwright.dev/docs/test-fixtures
 */

import { test as base, Page } from '@playwright/test';
import { setupE2EMocks, injectMockSession } from './mock-routes';
import { goToPublicRoute, debugWait } from './helpers';

/**
 * Custom fixture types
 */
export type E2EFixtures = {
    /**
     * A page with all Supabase mocks pre-configured.
     * Use this instead of `page` when testing authenticated flows.
     */
    mockedPage: Page;

    /**
     * A page with mocks configured and user already logged in.
     * Use this for tests that start from an authenticated state.
     */
    authenticatedPage: Page;
};

/**
 * Extended test object with custom fixtures.
 * 
 * Import this instead of `@playwright/test` in E2E tests:
 * ```ts
 * import { test, expect } from './fixtures';
 * ```
 */
export const test = base.extend<E2EFixtures>({
    /**
     * Fixture: mockedPage
     * 
     * Provides a page with all Supabase mocks configured but NOT logged in.
     * Use for tests that need to verify unauthenticated behavior.
     */
    mockedPage: async ({ page }, use) => {
        // Setup all mocks BEFORE any navigation
        await setupE2EMocks(page);

        // Provide the page to the test
        await use(page);

        // Cleanup (routes are automatically cleaned up with page)
        console.log('[E2E Fixture] mockedPage teardown complete');
    },

    /**
     * Fixture: authenticatedPage
     * 
     * Provides a page with mocks AND a logged-in user session.
     * Use for tests that start from an authenticated state.
     */
    authenticatedPage: async ({ page }, use) => {
        // Setup all mocks
        await setupE2EMocks(page);

        // Navigate to trigger app initialization
        // Navigate to trigger app initialization
        await goToPublicRoute(page, '/');

        // Wait for app to load
        await debugWait(
            'Initial App Load (#root > *)',
            page.waitForSelector('#root > *', { timeout: 10000 })
        );

        // Inject mock session
        await injectMockSession(page);

        // Reload to pick up the session
        await page.reload();

        // Wait for authenticated UI
        await debugWait(
            'Authenticated UI ([data-testid="app-main"])',
            page.waitForSelector('[data-testid="app-main"]', { timeout: 10000 })
        );

        // Provide the page to the test
        await use(page);

        console.log('[E2E Fixture] authenticatedPage teardown complete');
    },
});

// Re-export expect for convenience
export { expect } from '@playwright/test';

/**
 * Configuration for test.describe blocks
 * 
 * Use for parallel execution safety:
 * ```ts
 * test.describe.configure({ mode: 'serial' });
 * ```
 */
export const describeConfig = {
    /**
     * Serial mode - run tests one at a time (slower but safer for state-dependent tests)
     */
    serial: { mode: 'serial' as const },

    /**
     * Parallel mode - run tests concurrently (default, faster)
     */
    parallel: { mode: 'parallel' as const },
};
