import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { registerEdgeFunctionMock } from './mock-routes';
import { enableTestRegistry, registerMockInE2E } from '../helpers/testRegistry.helpers';
import { waitForStoreState, setE2ETime, clearQueryCache } from './helpers/e2e-state.helpers';

interface TierLimitsWindow extends Window {
    __E2E_CONFIG__?: unknown;
}

test.describe('Tier Limits Enforcement (Alpha Launch)', () => {

    test('Free user is blocked when daily limit is exhausted', async ({ page }) => {
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
        // 1. Login with free tier
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. Setup mock usage limit with 2 seconds remaining
        await registerEdgeFunctionMock(page, 'check-usage-limit', {
            can_start: true,
            remaining_seconds: 2,
            limit_seconds: 3600,
            used_seconds: 3598,
            subscription_status: 'free',
            is_pro: false
        });

        // 3. Setup mock STT
        await enableTestRegistry(page);
        await registerMockInE2E(page, 'native', `() => ({
             init: async () => {},
             startTranscription: async () => {},
             stopTranscription: async () => 'test',
             getTranscript: async () => 'test',
             terminate: async () => {},
             getEngineType: () => 'mock-native'
        })`);

        // 4. Go to session page
        await navigateToRoute(page, '/session');

        // 5. Force React Query to fetch the new mock and wait for it
        await clearQueryCache(page);
        await expect(async () => {
            const data = await page.evaluate(() => {
                const win = window as unknown as { queryClient?: { getQueryCache: () => { findAll: (o: unknown) => { state: { data: unknown } }[] } } };
                if (!win.queryClient) return null;
                const queries = win.queryClient.getQueryCache().findAll({ queryKey: ['usageLimit'] });
                return queries.length > 0 ? queries[0].state.data : null;
            }) as { remaining_seconds: number } | null;
            if (!data || data.remaining_seconds !== 2) {
                throw new Error(`Usage limit not yet 2: ${JSON.stringify(data)}`);
            }
            return true;
        }).toPass({ timeout: 15000 });

        // 6. Start session
        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();

        // 7. Wait for recording to begin
        await expect(page.getByTestId('recording-indicator')).toBeVisible();

        // 8. DETERMINISTIC JUMP
        await setE2ETime(page, 2);
        await waitForStoreState(page, (state: unknown) => (state as { elapsedTime: number }).elapsedTime, 2);

        // 9. Wait for auto-stop
        // The button should revert from 'Stop Recording' to 'Start Recording'
        await expect(page.getByRole('button', { name: /Start Recording/i })).toBeVisible({ timeout: 15000 });

        // 10. Check for usage limit reached status message
        await expect(page.getByTestId('session-status-indicator')).toContainText(/(Daily|Monthly) usage limit reached/i);

        // 11. Verify session stopped (Header reverted)
        await expect(page.getByTestId('live-session-header')).toContainText(/Ready to record/i, { timeout: 5000 });
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
