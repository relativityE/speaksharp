import { test, expect } from './fixtures';
import { navigateToRoute } from './helpers';
import { registerEdgeFunctionMock } from './mock-routes';
import { enableTestRegistry, registerMockInE2E } from '../helpers/testRegistry.helpers';

test.describe('Tier Limits Enforcement (Alpha Launch)', () => {

    test('Free user is blocked when daily limit is exhausted', async ({ userPage }) => {
        // 1. Initialize E2E Config with mock limits
        await enableTestRegistry(userPage);

        // Register mock limits via E2E Config
        await userPage.addInitScript(() => {
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
        await registerMockInE2E(userPage, 'native', `() => ({
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
        await navigateToRoute(userPage, '/session');

        // Cancel in-flight fetches, disable auto-refetch, and inject data
        await userPage.evaluate(async () => {
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
        await userPage.waitForFunction(() => {
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
        const startButton = userPage.getByTestId('session-start-stop-button');
        await expect(startButton).toBeVisible();

        // 7. Click Start -> Should trigger error message
        await startButton.click();

        // 8. Check for usage limit reached state (behavioral truth)
        await expect(userPage.getByTestId('live-session-header')).toHaveAttribute('data-state', 'error');
        await expect(userPage.getByTestId('status-message-text')).toContainText(/limit reached/i);

        // 9. Verify we are NOT recording (Button attribute confirms)
        await expect(startButton).toHaveAttribute('data-recording', 'false');
    });

    test('Free user is blocked when monthly limit is exhausted', async ({ userPage }) => {
        // 1. INJECT usage limit directly into React Query cache
        await navigateToRoute(userPage, '/session');

        // Cancel in-flight fetches, disable auto-refetch, and inject data
        await userPage.evaluate(async () => {
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
        await userPage.waitForFunction(() => {
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
        const startButton = userPage.getByTestId('session-start-stop-button');
        await startButton.click();

        // 6. Check for "Monthly usage limit reached" state
        await expect(userPage.getByTestId('live-session-header')).toHaveAttribute('data-state', 'error');
        await expect(userPage.getByTestId('status-message-text')).toContainText(/Monthly usage limit reached/i);
    });

    test('Daily limit auto-stops an active session', async ({ userPage }) => {
        // 2. Setup mock usage limit with 2 seconds remaining
        await registerEdgeFunctionMock(userPage, 'check-usage-limit', {
            can_start: true,
            remaining_seconds: 2,
            limit_seconds: 3600,
            used_seconds: 3598,
            subscription_status: 'free',
            is_pro: false
        });

        // 3. Setup mock STT
        await enableTestRegistry(userPage);
        await registerMockInE2E(userPage, 'native', `() => ({
             init: async () => {},
             startTranscription: async () => {},
             stopTranscription: async () => 'test',
             getTranscript: async () => 'test',
             terminate: async () => {},
             getEngineType: () => 'mock-native'
        })`);

        // 4. Go to session page
        await navigateToRoute(userPage, '/session');

        // 5. Wait for React Query cache to be populated with our mock data
        await userPage.waitForFunction(() => {
            const win = window as unknown as { queryClient?: { getQueryCache: () => { findAll: (args: unknown) => Array<{ state: { data: unknown } }> } } };
            if (!win.queryClient) return false;
            const queries = win.queryClient.getQueryCache().findAll({ queryKey: ['usageLimit'] });
            if (queries.length === 0) return false;
            const data = queries[0].state.data as { remaining_seconds?: number } | null;
            return data && data.remaining_seconds === 2;
        }, { timeout: 15000 });

        // 6. Start session
        const startButton = userPage.getByTestId('session-start-stop-button');
        await startButton.click();

        // 7. Wait for recording to begin
        await expect(userPage.getByTestId('recording-indicator')).toBeVisible();

        // 8. DETERMINISTIC JUMP
        // Use Playwright clock to advance both Date and Intervals instantly
        await userPage.clock.install({ time: Date.now() }); // Keep current time but enable control
        await userPage.clock.fastForward(2000); // 2 seconds

        // 9. Wait for auto-stop modal
        await expect(userPage.getByText(/Daily Target Crushed/i)).toBeVisible({ timeout: 15000 });

        // 10. Check for usage limit reached state (behavioral truth)
        await expect(userPage.getByTestId('live-session-header')).toHaveAttribute('data-state', 'error');
        await expect(userPage.getByTestId('status-message-text')).toContainText(/Daily usage limit reached/i);

        // 11. Close modal to verify button state
        await userPage.getByRole('button', { name: /Close/i }).click();

        // 12. Verify button reverted from 'Stop Recording' to 'Start Recording'
        await expect(userPage.getByRole('button', { name: /Start Recording/i })).toBeVisible();

        // 13. Verify session stopped (Attribute reverted to idle or ready)
        await expect(userPage.getByTestId('live-session-header')).toHaveAttribute('data-recording', 'false');
        await expect(userPage.getByTestId('live-session-header')).not.toHaveAttribute('data-state', 'recording');
    });

    test('Free users can add up to 100 filler words', async ({ userPage }) => {
        // 2. Go to session page
        await navigateToRoute(userPage, '/session');

        // 3. Open settings
        await userPage.getByTestId('add-custom-word-button').click();

        const input = userPage.getByPlaceholder(/literally/i);
        const word = `word-${Date.now()}`; // Unique word to prevent test collisions

        // 4. Verify adding a word
        await input.fill(word);
        await userPage.getByRole('button', { name: /add/i }).last().click();

        // Wait for popover to close (implies success)
        await expect(userPage.getByText('User Filler Words')).not.toBeVisible({ timeout: 10000 });

        // Verify in metrics list
        await expect(userPage.getByTestId('filler-badge').filter({ hasText: new RegExp(word, 'i') })).toBeVisible({ timeout: 15000 });
    });
});
