import { test, expect } from './fixtures';
import { navigateToRoute, mockLiveTranscript, attachLiveTranscript } from './helpers';

test.describe('Core User Journey', () => {
    test('should complete a full session and verify analytics data', async ({ proPage }) => {
        // Show only errors and warnings in CI (set E2E_DEBUG=true for all logs)
        attachLiveTranscript(proPage);

        // Navigate to Session Page via UI
        const startSessionBtn = proPage.getByRole('link', { name: /start session/i }).first();
        if (await startSessionBtn.isVisible()) {
            await startSessionBtn.click();
        } else {
            await navigateToRoute(proPage, '/session');
        }

        await expect(proPage).toHaveURL(/\/session/);

        // Ensure app settlement and bridge readiness
        await proPage.waitForFunction(() => window.__e2eProfileLoaded__ === true, null, { timeout: 30000 });
        await proPage.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

        // 3. Start Recording
        const startButton = proPage.getByTestId('session-start-stop-button');
        await expect(startButton).toBeEnabled();
        await startButton.click();

        // 4. Simulate Speech - wait for recording to start
        const stopButton = proPage.getByRole('button', { name: /stop/i }).first();
        await expect(stopButton).toBeVisible();
        await mockLiveTranscript(proPage, [
            "Hello everyone,",
            "um, today I want to talk about,",
            "uh, important metrics.",
            "Basically, we need to improve performance."
        ]);

        // Wait to accumulate some duration (Must be > 5s per policy)
        await proPage.waitForTimeout(6000);

        // 5. Stop Recording
        // (stopButton already defined above)
        await stopButton.click();

        // 6. Verify session saved behaviorally
        // We wait for the deterministic HTML attribute signal which survives component unmounts
        const html = proPage.locator('html');
        await expect(html).toHaveAttribute('data-session-saved', 'true', { timeout: 20000 });
        
        // Also ensure start button is visible (reset condition)
        await expect(proPage.getByRole('button', { name: /start/i }).first()).toBeVisible();

        // 7. Navigate to Analytics
        await navigateToRoute(proPage, '/analytics');
        await proPage.waitForLoadState('domcontentloaded');

        // 8. Verify Data Persistence (assertions only - no console.log for success)
        await expect(proPage.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });

        const sessionItems = proPage.locator('[data-testid^="session-history-item-"]');
        await expect(sessionItems.first()).toBeVisible({ timeout: 10000 });

        // Verify Total Sessions incremented (MOCK_SESSION_HISTORY has 5, new one makes 6)
        const totalSessionsCard = proPage.getByTestId('stat-card-total_sessions');
        await expect(totalSessionsCard).toContainText('6');
    });
});
