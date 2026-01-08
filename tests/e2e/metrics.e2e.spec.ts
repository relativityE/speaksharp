import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, mockLiveTranscript } from './helpers';
import { TEST_IDS } from '../constants';

test.describe('Session Metrics', () => {
    test('should update WPM, Clarity Score, and Filler Words in real-time', async ({ page }) => {
        // Enable console logging
        page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
        page.on('pageerror', err => console.log(`[BROWSER ERROR] ${err.message}`));

        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');

        console.log('[TEST] ✅ Navigated to /session');

        // Start recording
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();
        console.log('[TEST] ✅ Clicked start button');

        // Wait for Stop button (more stable than text which can transition quickly)
        await expect(page.getByRole('button', { name: /stop/i })).toBeVisible({ timeout: 15000 });
        console.log('[TEST] ✅ Stop button visible - recording active');

        // Wait to ensure timer ticks (elapsedTime > 0) so WPM calculation works
        await page.waitForTimeout(1500);

        // Target the WPM card
        const wpmValue = page.getByTestId(TEST_IDS.WPM_VALUE);

        // Verify initial WPM is 0
        await expect(wpmValue).toHaveText('0');
        console.log('[TEST] ✅ Initial WPM is 0');

        // Inject clean text
        console.log('[TEST] 🚀 Dispatching transcript event...');
        await mockLiveTranscript(page, ["Hello world this is a test"], 1000);
        console.log('[TEST] ✅ Transcript event dispatched');

        // Wait for WPM to update (deterministic polling instead of fixed timeout)
        console.log('[TEST] ⏳ Waiting for WPM to update...');
        await expect(async () => {
            const wpmText = await wpmValue.textContent();
            expect(parseInt(wpmText || '0')).toBeGreaterThan(0);
        }).toPass({ timeout: 10000 });
        console.log('[TEST] ✅ WPM updated from 0');

        // Verify Clarity Score (should be high since mock doesn't trigger filler detection)
        const clarityValue = page.getByTestId(TEST_IDS.CLARITY_SCORE_VALUE);
        const clarityText = await clarityValue.textContent();
        console.log('[TEST] Clarity Score:', clarityText);
        expect(parseInt(clarityText || '0')).toBeGreaterThan(80);
        console.log('[TEST] ✅ Clarity Score is good');

        // Inject filler words
        console.log('[TEST] 🚀 Injecting filler words (lowercase: um, uh, like, so)...');
        await mockLiveTranscript(page, ["um uh like so you know"], 1000);

        // Allow React state to propagate (filler detection is async)
        await page.waitForTimeout(500);

        // Wait for filler detection (deterministic polling with increased interval)
        const fillerValue = page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE);
        await expect(async () => {
            const fillerText = await fillerValue.textContent();
            console.log('[TEST] Polling filler count:', fillerText);
            expect(parseInt(fillerText || '0')).toBeGreaterThanOrEqual(1);
        }).toPass({ timeout: 15000, intervals: [500, 1000, 1500] });

        // Debug: Check the transcript content
        const transcriptElement = page.getByTestId(TEST_IDS.TRANSCRIPT_CONTAINER);
        const transcriptText = await transcriptElement.textContent();
        console.log('[TEST] Transcript content:', transcriptText);
        console.log('[TEST] ✅ Filler words detected');
    });
});
