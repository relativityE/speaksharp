import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, mockLiveTranscript } from './helpers';

test.describe('Core User Journey', () => {
    test('should complete a full session and verify analytics data', async ({ page }) => {
        // Enable console log debugging
        page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));

        // 1. Login as Pro user to bypass tier limits
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });

        // 2. Navigate to Session Page via UI (Simulating real user flow)
        // Click "Start Session" from Home/Dashboard
        const startSessionBtn = page.getByRole('link', { name: /start session/i }).first();
        if (await startSessionBtn.isVisible()) {
            await startSessionBtn.click();
        } else {
            // Fallback if UI is different on initial load
            await navigateToRoute(page, '/session');
        }

        await expect(page).toHaveURL(/\/session/);


        // 3. Start Recording
        const startButton = page.getByTestId('session-start-stop-button');
        await expect(startButton).toBeEnabled();
        await startButton.click();

        // 4. Simulate Speech
        // Wait for Stop button (more stable than text which can transition quickly)
        await expect(page.getByRole('button', { name: /stop/i })).toBeVisible({ timeout: 15000 });
        console.log('[TEST] ✅ Stop button visible - recording active');
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

        // 6. Wait for save to complete and navigate to Analytics
        // Ensure session has stopped (button shows "Start")
        await expect(page.getByRole('button', { name: /start/i })).toBeVisible({ timeout: 10000 });
        console.log('[TEST] ✅ Session stopped');

        // Use page.goto for reliable navigation (link-based navigation has React Router issues in tests)
        await navigateToRoute(page, '/analytics');
        await page.waitForLoadState('domcontentloaded');
        console.log('[TEST] ✅ Navigated to /analytics via goto');

        // 7. Verify Data Persistence
        // Wait for the dashboard heading to appear (indicates page loaded)
        console.log('[TEST] Waiting for dashboard heading...');
        await expect(page.getByTestId('dashboard-heading')).toBeVisible({ timeout: 15000 });
        console.log('[TEST] ✅ Dashboard heading visible');

        // Check for session items using the correct selector
        console.log('[TEST] Waiting for session items...');
        const sessionItems = page.locator('[data-testid^="session-history-item-"]');
        const itemCount = await sessionItems.count();
        console.log('[TEST] Session items found:', itemCount);
        await expect(sessionItems.first()).toBeVisible({ timeout: 10000 });
        console.log('[TEST] ✅ Session items visible');

        // Verify stats in the latest session card
        // We mocked 4 lines, containing "um" and "uh"
        // The mock RPC uses the passed data. 
        // Note: mockLiveTranscript updates the frontend state.
        // When stopped, frontend sends data to RPC.
        // Our RPC mock needs to support the data structure sent by frontend.

        // Verify Total Sessions incremented (MOCK_SESSION_HISTORY has 5, new one makes 6)
        const totalSessionsCard = page.getByTestId('stat-card-total_sessions');
        await expect(totalSessionsCard).toContainText('6');

        console.log('✅ Core Journey (Home -> Session -> Analytics) verified successfully');
    });
});
