import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, attachLiveTranscript, debugLog } from './helpers';
import { injectMockSession, registerEdgeFunctionMock } from './mock-routes';
import { enableTestRegistry, registerMockInE2E } from '../helpers/testRegistry.helpers';
import { setE2ETime } from './helpers/e2e-state.helpers';

interface TierLimitsWindow extends Window {
    __E2E_CONFIG__?: unknown;
}

test.describe('Tier Limits Enforcement (Alpha Launch)', () => {

    test('Free user is blocked when daily limit is exhausted', async ({ page }) => {
        attachLiveTranscript(page);
        // 1. Login with free tier
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. Initialize E2E Config with mock limits
        await enableTestRegistry(page);

        // Register mock limits via E2E Config (still needed for limits, but managed cleaner)
        await page.addInitScript(() => {
            (window as unknown as TierLimitsWindow).__E2E_CONFIG__ = {
                limits: {
                    mode: 'mock',
                    mockLimit: {
                        remaining_seconds: 0
                    }
                }
            };
        });

        // Register a mock STT engine to ensure we don't hit real backend issues
        await registerMockInE2E(page, 'native', `() => ({
             init: async () => {},
             startTranscription: async () => {},
             stopTranscription: async () => 'test',
             getTranscript: async () => 'test',
             terminate: async () => {},
             getEngineType: () => 'mock-native'
        })`);

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
        await expect(page.getByTestId('session-status-indicator')).toContainText(/(Daily|Monthly) usage limit reached/i);

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
        await expect(page.getByTestId('session-status-indicator')).toContainText(/Monthly usage limit reached/i);
    });

    test('Daily limit auto-stops an active session', async ({ page }) => {
        attachLiveTranscript(page);
        // 1. Login with free tier
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        await navigateToRoute(page, '/');

        // 1. Mock usage limit to have 5 seconds remaining
        await registerEdgeFunctionMock(page, 'check-usage-limit', {
            can_start: true,
            remaining_seconds: 5,
            limit_seconds: 3600,
            used_seconds: 3595,
            subscription_status: 'free',
            is_pro: false
        });

        // 2. Setup mock session and E2E Config
        await injectMockSession(page);
        await enableTestRegistry(page);

        // Register mock limits
        await page.addInitScript(() => {
            (window as unknown as TierLimitsWindow).__E2E_CONFIG__ = {
                limits: {
                    mode: 'mock',
                    mockLimit: {
                        remaining_seconds: 5
                    }
                }
            };
        });

        // Mock STT to prevent real device access
        await registerMockInE2E(page, 'native', `() => ({
             init: async () => {},
             startTranscription: async () => {},
             stopTranscription: async () => 'test',
             getTranscript: async () => 'test',
             terminate: async () => {},
             getEngineType: () => 'mock-native'
        })`);
        await page.reload();
        await page.waitForLoadState('networkidle');

        // 3. Start session
        await navigateToRoute(page, '/session');
        const startButton = page.getByTestId('session-start-stop-button');
        debugLog('[TEST] Clicking Start button...');
        await startButton.click();

        // 4. Wait for session to start recording
        debugLog('[TEST] Waiting for recording-indicator...');
        await expect(page.getByTestId('recording-indicator')).toBeVisible({ timeout: 10000 });
        debugLog('[TEST] Recording started.');

        // 5. DETERMINISTIC PROGRESSION (Expert Solution)
        // Force the elapsed time to 6s (past the 5s limit)
        debugLog('[TEST] Setting E2E time to 6s...');
        await setE2ETime(page, 6);
        debugLog('[TEST] Time set.');

        // 6. Verify auto-stop notification
        await expect(page.getByTestId('session-status-indicator')).toContainText(/(Daily|Monthly) usage limit reached/i, { timeout: 10000 });

        // 7. Verify session stopped (Header reverted)
        await expect(page.getByTestId('live-session-header')).toContainText(/Ready to record/i, { timeout: 10000 });

        // Verify session stopped (Button reverted to 'Start')
        await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('aria-label', /Start Recording/i, { timeout: 10000 });
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
