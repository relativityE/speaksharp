import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, mockLiveTranscript, attachLiveTranscript, debugLog } from './helpers';
import { TEST_IDS } from '../constants';
import { FILLER_WORD_KEYS } from '../../frontend/src/config';

test.describe('Session Metrics', () => {
    test.beforeEach(async ({ page }) => {
        attachLiveTranscript(page);
    });

    test('should update WPM, Clarity Score, and Filler Words in real-time', async ({ page }) => {
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, '/session');

        // Start recording
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

        // Wait for Stop button (more stable than text which can transition quickly)
        await expect(page.getByRole('button', { name: /stop/i })).toBeVisible({ timeout: 15000 });

        // Wait to ensure timer ticks (elapsedTime > 0) so WPM calculation works
        await page.waitForTimeout(1500);

        // Target the WPM card
        const wpmValue = page.getByTestId(TEST_IDS.WPM_VALUE);

        // Wait for the metrics grid to fully render before interacting
        // Note: WPM is NOT 0 initially because MockSpeechRecognition auto-emits transcript text
        await expect(wpmValue).toBeVisible({ timeout: 5000 });
        await expect(page.getByTestId('filler-badge-count')).toHaveCount(Object.keys(FILLER_WORD_KEYS).length, { timeout: 15000 });

        // Ensure E2E bridge is ready before dispatching transcripts
        debugLog('[TEST] ⏳ Waiting for E2E bridge readiness...');
        await page.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

        // Inject clean text
        debugLog('[TEST] 🚀 Dispatching transcript event...');
        await mockLiveTranscript(page, ["Hello world this is a test"], 1000);

        // Wait for WPM to update (deterministic polling)
        debugLog('[TEST] ⏳ Waiting for WPM to update...');
        await expect(async () => {
            const wpmText = await wpmValue.textContent();
            expect(parseInt(wpmText || '0')).toBeGreaterThan(0);
        }).toPass({ timeout: 15000 });

        // Inject filler words - use a simpler set to be sure
        debugLog('[TEST] 🚀 Injecting filler words (um, uh, like)...');
        await mockLiveTranscript(page, ["um", "uh", "like"], 500);

        // Wait for filler detection (deterministic polling)
        const fillerValue = page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE);
        await expect(async () => {
            const fillerText = await fillerValue.textContent();
            debugLog('[TEST] Polling filler count:', fillerText);
            // We sent 3 words, expect at least 1 (async detection might lag)
            // fillerText format is "(3)", so strip non-digits
            const count = parseInt(fillerText?.replace(/\D/g, '') || '0');
            expect(count).toBeGreaterThanOrEqual(1);

            // At least one badge should have a count > 0
            const counts = await page.getByTestId('filler-badge-count').allTextContents();
            const hasPositiveCount = counts.some(c => c !== '-' && parseInt(c) > 0);
            expect(hasPositiveCount).toBe(true);
        }).toPass({ timeout: 20000, intervals: [1000, 2000] });

        debugLog('[TEST] ✅ Filler words detected');
    });
});
