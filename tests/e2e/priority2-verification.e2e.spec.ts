import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { enableTestRegistry, registerMockInE2E } from '../helpers/testRegistry.helpers';

test.describe('Inversion Safety: Priority 2 Features', () => {

    test('Cross-Tab Mutex: Prevents Tab B from starting if Tab A is active', async ({ context }) => {
        const pageA = await context.newPage();
        const pageB = await context.newPage();

        // 1. Setup Tab A (Free user)
        await programmaticLoginWithRoutes(pageA, { subscriptionStatus: 'free' });
        await enableTestRegistry(pageA);
        await registerMockInE2E(pageA, 'native', `() => ({
             init: async () => {},
             startTranscription: async () => {},
             stopTranscription: async () => 'test',
             getTranscript: async () => 'test',
             terminate: async () => {},
             getEngineType: () => 'mock-native'
        })`);

        await navigateToRoute(pageA, '/session');
        await pageA.getByTestId('session-start-stop-button').click();

        // 2. Wait for Tab A to acquire lock deterministically
        await pageA.waitForFunction(() => (window as unknown as { __lockAcquired__?: boolean }).__lockAcquired__ === true, { timeout: 10000 });
        await expect(pageA.getByTestId('recording-indicator')).toBeVisible();

        // 2. Setup Tab B (Same user, SAME context/localStorage)
        await programmaticLoginWithRoutes(pageB, { subscriptionStatus: 'free' });
        await enableTestRegistry(pageB);
        await navigateToRoute(pageB, '/session');

        // 3. Attempt to start in Tab B
        await pageB.getByTestId('session-start-stop-button').click();

        // 4. Verify lockout message in Tab B
        const statusIndicator = pageB.getByTestId('session-status-indicator');
        // Detection is nearly instant via shared context, but we poll for UI consistency
        await expect(statusIndicator).toContainText(/Active session in another tab/i, { timeout: 10000 });

        // Verify Tab B signal is false
        const lockStateB = await pageB.evaluate(() => (window as unknown as { __lockAcquired__?: boolean }).__lockAcquired__);
        expect(lockStateB).toBe(false);

        await expect(pageB.getByTestId('recording-indicator')).not.toBeVisible();
    });

    test('VAD Auto-Pause: Stops session after 5 minutes of silence', async ({ page }) => {
        // 1. Login
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' }); // Pro user too
        await enableTestRegistry(page);

        // Mock engine that produces NO transcripts
        await registerMockInE2E(page, 'native', `() => ({
             init: async () => {},
             startTranscription: async () => {},
             stopTranscription: async () => '',
             getTranscript: async () => '',
             terminate: async () => {},
             getEngineType: () => 'mock-silent'
        })`);

        await navigateToRoute(page, '/session');

        // 2. Start session
        await page.getByTestId('session-start-stop-button').click();
        await expect(page.getByTestId('recording-indicator')).toBeVisible();

        // 3. Simulate 5 minutes passing deterministically
        // Use Playwright clock to advance setInterval cycles instantly
        await page.clock.install();

        const fiveMinsPlus = 5 * 60 * 1000 + 10000; // 5m 10s
        await page.clock.fastForward(fiveMinsPlus);

        // 4. Wait for the inactivity check to trigger
        // We use a longer timeout and check for the feedback message
        await expect(page.getByTestId('session-status-indicator')).toContainText(/Auto-paused/i, { timeout: 20000 });
        await expect(page.getByTestId('recording-indicator')).not.toBeVisible();
    });
});
