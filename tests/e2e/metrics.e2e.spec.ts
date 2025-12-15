import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, mockLiveTranscript } from './helpers';
import { TEST_IDS } from '../constants';

test.describe('Session Metrics', () => {
    test('should update WPM, Clarity Score, and Filler Words in real-time', async ({ page }) => {
        // Enable console logging
        page.on('console', msg => console.log(`[BROWSER] ${msg.text()}`));
        page.on('pageerror', err => console.log(`[BROWSER ERROR] ${err.message}`));

        await programmaticLoginWithRoutes(page);
        await navigateToRoute(page, '/session');

        console.log('[TEST] ✅ Navigated to /session');

        // Start recording
        await page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();
        console.log('[TEST] ✅ Clicked start button');

        // Wait for button to change to "Stop" state
        // Note: Desktop button has 'Stop', Mobile has 'Stop Recording'. Both contain 'Stop'.
        const stopButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);
        await expect(stopButton).toBeVisible();
        await expect(stopButton).toContainText('Stop');
        console.log('[TEST] ✅ Stop button visible - service should be ready');

        // Target the WPM card
        const wpmValue = page.getByTestId(TEST_IDS.WPM_VALUE);

        // Verify initial WPM is 0
        await expect(wpmValue).toHaveText('0');
        console.log('[TEST] ✅ Initial WPM is 0');

        // Inject clean text
        console.log('[TEST] 🚀 Dispatching transcript event...');
        await mockLiveTranscript(page, ["Hello world this is a test"], 1000);
        console.log('[TEST] ✅ Transcript event dispatched');

        // Wait for metrics to update
        console.log('[TEST] ⏳ Waiting 2 seconds for metrics to update...');
        await page.waitForTimeout(2000);

        // Verify WPM updated (should be > 0)
        const wpmText = await wpmValue.textContent();
        console.log('[TEST] WPM value after transcript:', wpmText);
        await expect(wpmValue).not.toHaveText('0');
        console.log('[TEST] ✅ WPM updated from 0');

        // Verify Clarity Score (should be high since no fillers)
        const clarityValue = page.getByTestId(TEST_IDS.CLARITY_SCORE_VALUE);
        const clarityText = await clarityValue.textContent();
        console.log('[TEST] Clarity Score:', clarityText);
        // Clarity should be > 80% for clean speech
        expect(parseInt(clarityText || '0')).toBeGreaterThan(80);
        console.log('[TEST] ✅ Clarity Score is good');

        // Now inject filler words
        console.log('[TEST] 🚀 Injecting filler words...');
        await mockLiveTranscript(page, ["Um, actually, uh, maybe"], 1000);
        await page.waitForTimeout(1000);

        // Verify Filler Count increased
        const fillerValue = page.getByTestId(TEST_IDS.FILLER_COUNT_VALUE);
        const fillerText = await fillerValue.textContent();
        console.log('[TEST] Filler Words count:', fillerText);
        // Should have at least 2 fillers (Um, uh)
        expect(parseInt(fillerText || '0')).toBeGreaterThanOrEqual(2);
        console.log('[TEST] ✅ Filler words detected');
    });
});
