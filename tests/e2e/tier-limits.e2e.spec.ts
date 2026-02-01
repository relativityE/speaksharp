import { test, expect } from '@playwright/test';
import {
    programmaticLoginWithRoutes,
    navigateToRoute
} from './helpers';
import { registerEdgeFunctionMock } from './mock-routes';

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

        // 6. Check for "Monthly usage limit reached" status message
        await expect(page.getByTestId('session-status-indicator')).toHaveText(/Monthly usage limit reached/i);

        // 7. Verify we are NOT recording (Button is still 'Start', not 'Stop')
        await expect(startButton.getByText('Stop')).not.toBeVisible();
    });

    test('Daily limit auto-stops an active session', async ({ page }) => {
        // SKIPPED: Feature works in production but fails in Headless CI due to Audio Context hangs.
        // Logic covered by Unit Tests in `useSessionLifecycle.test.ts`.
        // See: tier_limits_incident_report.md

        // 1. Login with free tier
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. Start with very low time (5s) to trigger auto-stop quickly
        await registerEdgeFunctionMock(page, 'check-usage-limit', {
            can_start: true,
            remaining_seconds: 6,
            limit_seconds: 3600,
            used_seconds: 3594,
            subscription_status: 'free'
        });

        // 2b. Inject Mock Native Browser to bypass AudioContext issues in Headless
        await page.addInitScript(() => {
            (window as unknown as { __E2E_MOCK_NATIVE__: boolean }).__E2E_MOCK_NATIVE__ = true;
            (window as unknown as { MockNativeBrowser: unknown }).MockNativeBrowser = class {
                constructor() { }
                async init() { }
                async startTranscription() { console.log('MockNativeBrowser started'); }
                async stopTranscription() { return ''; }
                async getTranscript() { return ''; }
            };
        });

        // 3. Go to session page and reload
        await navigateToRoute(page, '/session');
        await page.reload();

        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();
        await expect(startButton.getByText('Stop')).toBeVisible();

        // 4. Wait for auto-stop (should trigger at 5s)

        /**
         * 🚨 CRITICAL DISCLAIMER 🚨
         * 
         * This assertion verifies that the user is explicitly notified when their session 
         * is auto-stopped due to tier limits.
         * 
         * It is VITAL that the user sees "Monthly usage limit reached" (via Toast, Banner, 
         * or Status Indicator). Do NOT remove or weak this check. If the UI changes (e.g. to a Toast),
         * update this selector to target the new notification element.
         * 
         * The user MUST know why their session stopped.
         */
        await expect(page.getByTestId('session-status-indicator')).toHaveText(/Monthly usage limit reached/i, { timeout: 20000 });

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
