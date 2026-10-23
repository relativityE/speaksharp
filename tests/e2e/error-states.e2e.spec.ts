import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { navigateToRoute, debugLog, programmaticLoginWithRoutes } from './helpers';

/**
 * E2E Error State Tests
 * 
 * Tests for critical error conditions that users may encounter.
 * These those verify the app handles errors gracefully without crashing.
 * 
 * Note: In E2E mock mode, mic is bypassed via __E2E_MOCK_SESSION__ flag.
 * These tests verify network error handling and app stability.
 */

test.describe('Error State Handling', () => {
    test.describe('Session Page Stability', () => {
        test('should load session page and show start button', async ({ userPage }) => {
            await navigateToRoute(userPage, '/session');

            // App should load with session UI elements
            await expect(userPage.getByTestId('nav-account-avatar')).toBeVisible({ timeout: 15000 });

            // Start button should be present
            const startButton = userPage.getByTestId('mic-start');
            await expect(startButton).toBeVisible({ timeout: 10000 });

            debugLog('[TEST] ✅ Session page loaded with start button');
        });

        test('should remain functional after clicking start in mock mode', async ({ userPage }) => {
            await navigateToRoute(userPage, '/session');

            await expect(userPage.getByTestId('nav-account-avatar')).toBeVisible({ timeout: 15000 });

            // Try to start session (using mock session mode)
            const startButton = userPage.getByTestId('mic-start');
            await expect(startButton).toBeVisible({ timeout: 10000 });

            if (await startButton.isEnabled()) {
                await startButton.click();
                
                // Determine state reached via recording attribute
                await expect(userPage.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 10000 });

                // App should remain functional
                await expect(userPage.getByTestId('nav-account-avatar')).toBeVisible();
            }

            debugLog('[TEST] ✅ Session interaction handled gracefully');
        });
    });

    /**
     * CO016 — the profile read the app actually consumes is the injected client's `user_profiles` query
     * (useUserProfile → profileService.getById → getSupabaseClient(), which prefers window.supabase), so the
     * fault is armed there, before login reaches profile readiness. The old test aborted a `users*` URL the app
     * never requests and then only checked that the body had text, so it passed against a healthy profile.
     */
    test.describe('Network Error Handling', () => {
        /** The designated assertion every control must fail on: a genuine, injected profile failure was consumed. */
        const CONSUMED = 'injected user_profiles failures consumed';

        const windowCount = (page: Page, key: '__E2E_PROFILE_QUERIES_CO016__' | '__E2E_PROFILE_FAILURES_CO016__') =>
            page.evaluate((k) => (window as unknown as Record<string, number | undefined>)[k] ?? 0, key);

        const clearProfileFault = (page: Page) => page.evaluate(() => {
            window.sessionStorage.setItem('__e2e_profile_fault_cleared_co016', '1');
            delete (window as unknown as { __E2E_PROFILE_FAULT_CO016__?: string }).__E2E_PROFILE_FAULT_CO016__;
        });

        /**
         * The truthful failure state, asserted BEFORE any recovery. First the cause: the first read plus
         * useUserProfile's three retries each consumed an injected error. Then the screen: Profile Sync Failed with
         * its recovery actions, and no protected app (Navigation and the session page render inside ProfileGuard).
         */
        const expectProfileSyncFailed = async (page: Page) => {
            await expect.poll(() => windowCount(page, '__E2E_PROFILE_FAILURES_CO016__'), { message: CONSUMED, timeout: 15_000 })
                .toBeGreaterThanOrEqual(4);
            const failure = page.getByTestId('app-error');
            await expect(failure).toBeVisible({ timeout: 15_000 });
            await expect(failure.getByRole('heading', { name: 'Profile Sync Failed' })).toBeVisible();
            await expect(failure.getByRole('button', { name: 'Retry Sync' })).toBeVisible();
            await expect(failure.getByRole('button', { name: 'Sign Out' })).toBeVisible();
            await expect(page.getByTestId('nav-account-avatar')).toHaveCount(0);
            await expect(page.getByTestId('mic-start')).toHaveCount(0);
        };

        /** A control passes only if the oracle rejects it on the designated assertion; any other error fails it. */
        const expectRejectedForNoConsumedFailure = async (page: Page) => {
            const rejection = await expectProfileSyncFailed(page).then(() => null, (error: unknown) => error);
            expect(rejection, 'the oracle must reject this state').not.toBeNull();
            expect(String((rejection as Error).message), 'rejected on the designated assertion, not a setup error').toContain(CONSUMED);
            expect(await windowCount(page, '__E2E_PROFILE_FAILURES_CO016__'), 'no injected failure was consumed').toBe(0);
            expect(await windowCount(page, '__E2E_PROFILE_QUERIES_CO016__'), 'the profile read actually ran').toBeGreaterThanOrEqual(1);
        };

        test('profile fetch failure shows Profile Sync Failed, and Retry Sync recovers', async ({ page }) => {
            await programmaticLoginWithRoutes(page, { profileFault: 'error' });

            await expectProfileSyncFailed(page);

            await clearProfileFault(page);
            const failedReads = await windowCount(page, '__E2E_PROFILE_QUERIES_CO016__');
            await page.getByTestId('app-error').getByRole('button', { name: 'Retry Sync' }).click();
            await expect(page.getByTestId('app-error')).toHaveCount(0, { timeout: 15_000 });
            await expect(page.locator('html')).toHaveAttribute('data-profile-ready', 'true');
            expect(await windowCount(page, '__E2E_PROFILE_QUERIES_CO016__'), 'Retry Sync re-read the profile').toBeGreaterThan(failedReads);

            await navigateToRoute(page, '/session');
            await expect(page.getByTestId('mic-start')).toBeVisible({ timeout: 10_000 });
            debugLog('[TEST] ✅ Profile Sync Failed shown on a genuine failure and cleared by Retry Sync');
        });

        // Negative controls: each is a state the old test accepted, and each must be rejected for the stated reason.
        test('CONTROL: a healthy profile behind the old wrong-URL interceptor is not a sync failure', async ({ page }) => {
            await page.route('**/rest/v1/users*', (route) => route.abort('failed'));
            await programmaticLoginWithRoutes(page);
            await expectRejectedForNoConsumedFailure(page);
        });

        test('CONTROL: a swallowed error (no row, no error) is not a sync failure', async ({ page }) => {
            await programmaticLoginWithRoutes(page, { profileFault: 'swallowed' });
            await expectRejectedForNoConsumedFailure(page);
        });
    });
});
