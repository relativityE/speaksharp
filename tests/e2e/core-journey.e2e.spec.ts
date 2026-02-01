import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, mockLiveTranscript, attachLiveTranscript } from './helpers';

test.describe('Core User Journey', () => {
    test.beforeEach(async ({ page }) => {
        // Show only errors and warnings in CI (set E2E_DEBUG=true for all logs)
        attachLiveTranscript(page);
    });

    test('should complete a full session and verify analytics data', async ({ page }) => {
        // 1. Login as Pro user to bypass tier limits
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

        // 2. Navigate to Session Page via UI
        const startSessionBtn = page.getByRole('link', { name: /start session/i }).first();
        if (await startSessionBtn.isVisible()) {
            await startSessionBtn.click();
        } else {
            await navigateToRoute(page, '/session');
        }

        await expect(page).toHaveURL(/\/session/);

        // Ensure app settlement and bridge readiness
        await page.waitForFunction(() => window.__e2eProfileLoaded__ === true, null, { timeout: 30000 });
        await page.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

        // 3. Start Recording
        const startButton = page.getByTestId('session-start-stop-button');
        await expect(startButton).toBeEnabled();
        await startButton.click();

        // 4. Simulate Speech - wait for recording to start
        await expect(page.getByRole('button', { name: /stop/i })).toBeVisible();
        await mockLiveTranscript(page, [
            "Hello everyone,",
            "um, today I want to talk about,",
            "uh, important metrics.",
            "Basically, we need to improve performance."
        ]);

        // Wait to accumulate some duration (Must be > 5s per policy)
        await page.waitForTimeout(6000);

        // 5. Stop Recording
        const stopButton = page.getByTestId('session-start-stop-button');
        await stopButton.click();

        // 6. Verify session stopped
        await expect(page.getByRole('button', { name: /start/i })).toBeVisible({ timeout: 10000 });

        // 7. Navigate to Analytics
        await navigateToRoute(page, '/analytics');
        await page.waitForLoadState('domcontentloaded');

        // 8. Verify Data Persistence (assertions only - no console.log for success)
        await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });

        const sessionItems = page.locator('[data-testid^="session-history-item-"]');
        await expect(sessionItems.first()).toBeVisible({ timeout: 10000 });

        // Verify Total Sessions incremented (MOCK_SESSION_HISTORY has 5, new one makes 6)
        const totalSessionsCard = page.getByTestId('stat-card-total_sessions');
        await expect(totalSessionsCard).toContainText('6');
    });
});
