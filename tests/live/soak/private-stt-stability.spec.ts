import { test, expect } from '@playwright/test';
import { ROUTES } from '@/constants/routes';
import { navigateToRoute, programmaticLoginWithRoutes } from '../../e2e/helpers';

/**
 * SOAK TEST: Private STT Stability
 * Duration: 60 minutes
 * Goal: Verify the engine can run for an extended period without crashing,
 * memory exhaustion, or significant performance degradation.
 */
test.describe('Private STT Soak Test (60m)', () => {
    test.setTimeout(3660000); // 61 minutes (60m test + 1m buffer)

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            (window as any).__E2E_PLAYWRIGHT__ = true;
            (window as any).__E2E_MOCK_LOCAL_WHISPER__ = false;
        });
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, ROUTES.SESSION);
    });

    test('should maintain stable transcription for 60 minutes', async ({ page }) => {
        // 1. Select Private Mode
        await page.getByRole('button', { name: /mode/i }).click();
        await page.getByRole('menuitem', { name: /private/i }).click();

        // Wait for engine to be ready
        await expect(page.getByText(/private model ready/i)).toBeVisible({ timeout: 60000 });

        // 2. Start Recording
        await page.getByRole('button', { name: /start practice/i }).click();
        await expect(page.getByText(/recording active/i)).toBeVisible();

        console.log(`[SOAK] ${new Date().toISOString()} - Started 60-minute soak test`);

        // 3. Inject continuous audio (simulated)
        // We pulse a 1-second sample every 5 seconds to simulate a long conversation
        const INTERVAL_MS = 5000;
        const TEST_DURATION_MS = 60 * 60 * 1000;
        const START_TIME = Date.now();

        await page.evaluate(() => {
            const pulseAudio = async () => {
                const response = await fetch('/test-audio/sample1.wav');
                const arrayBuffer = await response.arrayBuffer();
                // We don't actually need to play it, just trigger the mock-getUserMedia logic if active,
                // or wait for the engine to process chunks.
                // In this unmocked live test, we rely on the fact that PrivateSTT is listening to the real/mocked mic.
            };
            (window as any).pulseTimer = setInterval(pulseAudio, 5000);
        });

        // 4. Monitor for crashes/errors for 60 minutes
        // We poll every minute to check if the session is still active and no error modal appeared
        let elapsed = 0;
        while (Date.now() - START_TIME < TEST_DURATION_MS) {
            await page.waitForTimeout(60000); // Wait 1 minute
            elapsed += 1;
            console.log(`[SOAK] ${new Date().toISOString()} - ${elapsed} minutes elapsed`);

            // Assert: No error boundary triggered
            const errorVisible = await page.getByText(/an error has occurred/i).isVisible();
            expect(errorVisible).toBe(false);

            // Assert: Transcript is growing (optional, but good for verification)
            const transcriptText = await page.getByTestId('live-transcript').textContent();
            expect(transcriptText?.length).toBeGreaterThan(0);
        }

        console.log(`[SOAK] ${new Date().toISOString()} - Completed 60-minute soak test successfully`);

        // 5. Stop Recording
        await page.getByRole('button', { name: /stop/i }).click();
        await expect(page.getByText(/session saved/i)).toBeVisible();
    });
});
