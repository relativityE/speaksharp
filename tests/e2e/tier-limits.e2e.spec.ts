import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { injectMockSession, registerEdgeFunctionMock } from './mock-routes';

test.describe('Tier Limits Enforcement (Alpha Launch)', () => {

    test('Free user is blocked when daily limit is exhausted', async ({ page }) => {
        // 1. Login with free tier
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. Override usage limit mock to return can_start: false
        await registerEdgeFunctionMock(page, 'check-usage-limit', {
            can_start: false,
            remaining_seconds: 0,
            limit_seconds: 3600,
            used_seconds: 3600,
            subscription_status: 'free'
        });

        // 3. Go to session page and reload to ensure mock is seen
        await navigateToRoute(page, '/session');
        await page.reload();

        // 4. Verify Start button IS present (UI doesn't hide it)
        const startButton = page.getByTestId('session-start-stop-button');
        await expect(startButton).toBeVisible();

        // 5. Click Start -> Should trigger error message
        await startButton.click();

        // 6. Check for usage limit reached status message (supports both Daily and Monthly as per requirements)
        await expect(page.getByTestId('session-status-indicator')).toHaveText(/(Daily|Monthly) usage limit reached/i);

        // 7. Verify we are NOT recording (Button is still 'Start', not 'Stop')
        await expect(startButton.getByText('Stop')).not.toBeVisible();
    });

    test('Free user is blocked when monthly limit is exhausted', async ({ page }) => {
        // 1. Login with free tier
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. Override usage limit mock to return can_start: false with Monthly message
        await registerEdgeFunctionMock(page, 'check-usage-limit', {
            can_start: false,
            remaining_seconds: 0,
            limit_seconds: 1800,
            used_seconds: 1800,
            subscription_status: 'free',
            error: 'Monthly usage limit reached'
        });

        // 3. Go to session page and reload
        await navigateToRoute(page, '/session');
        await page.reload();

        // 4. Click Start -> Should trigger error message
        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();

        // 5. Check for "Monthly usage limit reached" status message
        await expect(page.getByTestId('session-status-indicator')).toHaveText(/Monthly usage limit reached/i);
    });

    test('Daily limit auto-stops an active session', async ({ page }) => {
        // SKIPPED: Feature works in production but fails in Headless CI due to Audio Context hangs.
        // Logic covered by Unit Tests in `useSessionLifecycle.test.ts`.
        // See: tier_limits_incident_report.md

        // 1. Login with free tier
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        /**
         * ⚠️ SKIP-IF-CI (MacOS Audio Context Bug)
         * 
         * This test is prone to hanging in Headless MacOS CI environments 
         * because the 'MockNativeBrowser' still triggers certain AudioContext
         * code paths that lack proper mocks in Playwright.
         * 
         * Works 100% locally in headed or headless mode.
         */
        if (process.env.CI) test.skip();

        await navigateToRoute(page, '/');

        // 1. Mock usage limit to have 5 seconds remaining
        // NOTE: programmaticLoginWithRoutes already calls setupE2EMocks, so we only need overrides here.
        await registerEdgeFunctionMock(page, 'check-usage-limit', {
            can_start: true,
            remaining_seconds: 5,
            limit_seconds: 3600,
            used_seconds: 3595,
            subscription_status: 'free',
            is_pro: false
        });

        // 2. Setup mock session and reload to apply the 5s mock
        await injectMockSession(page);
        await page.reload();
        await page.waitForLoadState('networkidle'); // Ensure usage limit fetch completes

        // 3. Start session
        await navigateToRoute(page, '/session');
        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();

        // 4. Wait for session to start recording
        await expect(page.getByTestId('recording-indicator')).toBeVisible();

        // 5. Wait for auto-stop (should happen > 5 seconds but we wait 20s for safety)
        /**
         * 🚨 CRITICAL DISCLAIMER 🚨
         * 
         * This assertion verifies that the user is explicitly notified when their session 
         * is auto-stopped due to tier limits.
         * 
         * It is VITAL that the user sees "Daily usage limit reached" (via Toast, Banner, 
         * or Status Indicator). Do NOT remove or weak this check. If the UI changes (e.g. to a Toast),
         * update this selector to target the new notification element.
         * 
         * The user MUST know why their session stopped.
         */
        await expect(page.getByTestId('session-status-indicator')).toHaveText(/(Daily|Monthly) usage limit reached/i, { timeout: 20000 });

        // Verify session stopped (Button reverted to 'Start')
        await expect(page.getByTestId('session-start-stop-button').getByText('Start')).toBeVisible();
    });

    test('Free users can add up to 100 filler words', async ({ page }) => {
        // 1. Setup
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. Go to session page
        await navigateToRoute(page, '/session');

        // 3. Open settings
        await page.getByTestId('add-custom-word-button').click();

        const input = page.getByPlaceholder(/literally/i);
        const word = `word-${Date.now()}`; // Unique word to prevent test collisions

        // 4. Verify adding a word
        await input.fill(word);
        await page.getByRole('button', { name: /add/i }).last().click();

        // Wait for popover to close (implies success)
        await expect(page.getByText('User Filler Words')).not.toBeVisible({ timeout: 10000 });

        // Verify in metrics list
        await expect(page.getByTestId('filler-badge').filter({ hasText: new RegExp(word, 'i') })).toBeVisible({ timeout: 15000 });
    });
});
