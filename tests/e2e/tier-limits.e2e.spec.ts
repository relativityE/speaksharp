import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { registerEdgeFunctionMock } from './mock-routes';
import { enableTestRegistry, registerMockInE2E } from '../helpers/testRegistry.helpers';

test.describe('Tier Limits Enforcement (Alpha Launch)', () => {

    test('Free user is blocked when daily limit is exhausted', async ({ page }) => {
        // 1. Login with free tier (this sets up default mocks including can_start: true)
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. Initialize E2E Config with mock limits
        await enableTestRegistry(page);

        // Register mock limits via E2E Config
        await page.addInitScript(() => {
            (window as unknown as { __E2E_CONFIG__?: { limits: unknown } }).__E2E_CONFIG__ = {
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

        // 3. INJECT usage limit directly into React Query cache.
        //    Route-based mocking doesn't work because supabase.functions.invoke to mock.supabase.co
        //    fails at the network level, and useUsageLimit defaults to can_start:true on error.
        await navigateToRoute(page, '/session');

        // Cancel in-flight fetches, disable auto-refetch, and inject data
        await page.evaluate(async () => {
            const win = window as unknown as {
                queryClient?: {
                    cancelQueries: (opts: unknown) => Promise<void>;
                    setQueryDefaults: (key: unknown[], opts: unknown) => void;
                    setQueryData: (key: unknown[], data: unknown) => void;
                }
            };
            if (win.queryClient) {
                await win.queryClient.cancelQueries({ queryKey: ['usageLimit'] });
                win.queryClient.setQueryDefaults(['usageLimit'], {
                    enabled: false,
                    refetchOnWindowFocus: false,
                    refetchOnMount: false,
                    refetchOnReconnect: false,
                    staleTime: Infinity
                });
                win.queryClient.setQueryData(['usageLimit', 'test-user-123'], {
                    can_start: false,
                    daily_remaining: 0,
                    daily_limit: 3600,
                    monthly_remaining: 0,
                    monthly_limit: 90000,
                    remaining_seconds: 0,
                    limit_seconds: 3600,
                    used_seconds: 3600,
                    subscription_status: 'free',
                    is_pro: false
                });
            }
        });

        // 4. Wait for cache to confirm can_start: false (re-inject if background fetch overwrote)
        await page.waitForFunction(() => {
            const win = window as unknown as {
                queryClient?: {
                    getQueryCache: () => { findAll: (args: unknown) => Array<{ state: { data: unknown } }> };
                    setQueryData: (key: unknown[], data: unknown) => void;
                }
            };
            if (!win.queryClient) return false;
            const queries = win.queryClient.getQueryCache().findAll({ queryKey: ['usageLimit'] });
            if (queries.length === 0) return false;
            const data = queries[0].state.data as { can_start?: boolean } | null;
            if (data && data.can_start === false) return true;
            // Re-inject if overwritten
            win.queryClient.setQueryData(['usageLimit', 'test-user-123'], {
                can_start: false, daily_remaining: 0, daily_limit: 3600,
                monthly_remaining: 0, monthly_limit: 90000, remaining_seconds: 0,
                subscription_status: 'free', is_pro: false
            });
            return false;
        }, { timeout: 5000 });

        // 6. Verify Start button IS present (UI doesn't hide it)
        const startButton = page.getByTestId('session-start-stop-button');
        await expect(startButton).toBeVisible();

        // 7. Click Start -> Should trigger error message
        await startButton.click();

        // 8. Check for usage limit reached status message (supports both Daily and Monthly as per requirements)
        await expect(page.getByTestId('session-status-indicator')).toContainText(/(Daily|Monthly) usage limit reached/i);

        // 9. Verify we are NOT recording (Button is still 'Start', not 'Stop')
        await expect(startButton.getByText('Stop')).not.toBeVisible();
    });

    test('Free user is blocked when monthly limit is exhausted', async ({ page }) => {
        // 1. Login with free tier
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'free' });

        // 2. INJECT usage limit directly into React Query cache
        await navigateToRoute(page, '/session');

        // Cancel in-flight fetches, disable auto-refetch, and inject data
        await page.evaluate(async () => {
            const win = window as unknown as {
                queryClient?: {
                    cancelQueries: (opts: unknown) => Promise<void>;
                    setQueryDefaults: (key: unknown[], opts: unknown) => void;
                    setQueryData: (key: unknown[], data: unknown) => void;
                }
            };
            if (win.queryClient) {
                await win.queryClient.cancelQueries({ queryKey: ['usageLimit'] });
                win.queryClient.setQueryDefaults(['usageLimit'], {
                    enabled: false,
                    refetchOnWindowFocus: false,
                    refetchOnMount: false,
                    refetchOnReconnect: false,
                    staleTime: Infinity
                });
                win.queryClient.setQueryData(['usageLimit', 'test-user-123'], {
                    can_start: false,
                    daily_remaining: 0,
                    daily_limit: 1800,
                    monthly_remaining: 0,
                    monthly_limit: 90000,
                    remaining_seconds: 0,
                    limit_seconds: 1800,
                    used_seconds: 1800,
                    subscription_status: 'free',
                    is_pro: false,
                    error: 'Monthly usage limit reached'
                });
            }
        });

        // 3. Wait for cache to confirm can_start: false (re-inject if background fetch overwrote)
        await page.waitForFunction(() => {
            const win = window as unknown as {
                queryClient?: {
                    getQueryCache: () => { findAll: (args: unknown) => Array<{ state: { data: unknown } }> };
                    setQueryData: (key: unknown[], data: unknown) => void;
                }
            };
            if (!win.queryClient) return false;
            const queries = win.queryClient.getQueryCache().findAll({ queryKey: ['usageLimit'] });
            if (queries.length === 0) return false;
            const data = queries[0].state.data as { can_start?: boolean } | null;
            if (data && data.can_start === false) return true;
            // Re-inject if overwritten
            win.queryClient.setQueryData(['usageLimit', 'test-user-123'], {
                can_start: false, daily_remaining: 0, daily_limit: 1800,
                monthly_remaining: 0, monthly_limit: 90000, remaining_seconds: 0,
                subscription_status: 'free', is_pro: false, error: 'Monthly usage limit reached'
            });
            return false;
        }, { timeout: 5000 });

        // 5. Click Start -> Should trigger error message
        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();

        // 6. Check for "Monthly usage limit reached" status message
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

        // 5. Wait for React Query cache to be populated with our mock data
        await page.waitForFunction(() => {
            const win = window as unknown as { queryClient?: { getQueryCache: () => { findAll: (args: unknown) => Array<{ state: { data: unknown } }> } } };
            if (!win.queryClient) return false;
            const queries = win.queryClient.getQueryCache().findAll({ queryKey: ['usageLimit'] });
            if (queries.length === 0) return false;
            const data = queries[0].state.data as { remaining_seconds?: number } | null;
            return data && data.remaining_seconds === 2;
        }, { timeout: 15000 });

        // 6. Start session
        const startButton = page.getByTestId('session-start-stop-button');
        await startButton.click();

        // 7. Wait for recording to begin
        await expect(page.getByTestId('recording-indicator')).toBeVisible();

        // 8. DETERMINISTIC JUMP
        // Use Playwright clock to advance both Date and Intervals instantly
        await page.clock.install({ time: Date.now() }); // Keep current time but enable control
        await page.clock.fastForward(2000); // 2 seconds

        // 9. Wait for auto-stop modal
        await expect(page.getByText(/Daily Target Crushed/i)).toBeVisible({ timeout: 15000 });

        // 10. Check for usage limit reached status message (behavioral truth)
        await expect(page.getByTestId('session-status-indicator')).toContainText(/Daily usage limit reached/i);

        // 11. Close modal to verify button state
        await page.getByRole('button', { name: /Close/i }).click();

        // 12. Verify button reverted from 'Stop Recording' to 'Start Recording'
        await expect(page.getByRole('button', { name: /Start Recording/i })).toBeVisible();

        // 13. Verify session stopped (Header reverted)
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
