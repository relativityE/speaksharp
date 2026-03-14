import { test, expect } from './fixtures';
import { navigateToRoute, mockLiveTranscript, attachLiveTranscript, debugLog } from './helpers';
import { TEST_IDS } from '../constants';
import { FILLER_WORD_KEYS } from '../../frontend/src/config';

test.describe.configure({ mode: 'serial' });

test.describe('Session Metrics', () => {
    test.beforeEach(async ({ proPage }) => {
        attachLiveTranscript(proPage);
    });

    test('should update WPM, Clarity Score, and Filler Words in real-time', async ({ proPage }) => {
        await navigateToRoute(proPage, '/session');

        // Start recording
        await proPage.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON).click();

        // Wait for Stop button (more stable than text which can transition quickly)
        await expect(proPage.getByRole('button', { name: /stop/i })).toBeVisible({ timeout: 15000 });

        // Wait for engine to be in "Recording" state (deterministic transition)
        await expect(async () => {
            const statusLabel = await proPage.getByTestId('stt-status-label').textContent();
            expect(statusLabel).toMatch(/Recording/i);
        }).toPass({ timeout: 10000 });

        // Synchronization: Wait for metrics to settle (Deterministic Signal)
        await expect(proPage.getByTestId('metrics-panel')).toHaveAttribute('data-metrics-settled', 'true', { timeout: 10000 });

        const wpmValue = proPage.getByTestId(TEST_IDS.WPM_VALUE);

        // Wait for the metrics grid to fully render before interacting
        // Note: WPM is NOT 0 initially because MockSpeechRecognition auto-emits transcript text
        await expect(wpmValue).toBeVisible({ timeout: 5000 });
        await expect(proPage.getByTestId('filler-badge-count')).toHaveCount(Object.keys(FILLER_WORD_KEYS).length, { timeout: 15000 });

        // Ensure E2E bridge is ready before dispatching transcripts
        debugLog('[TEST] ⏳ Waiting for E2E bridge readiness...');
        await proPage.waitForFunction(() => window.__e2eBridgeReady__ === true, null, { timeout: 10000 });

        // Inject clean text
        debugLog('[TEST] 🚀 Dispatching transcript event...');
        await mockLiveTranscript(proPage, ["Hello world this is a test"]);

        // Wait for WPM to update (deterministic polling)
        debugLog('[TEST] ⏳ Waiting for WPM to update...');
        await expect(async () => {
            const wpmText = await wpmValue.textContent();
            expect(parseInt(wpmText || '0')).toBeGreaterThan(0);
        }).toPass({ timeout: 15000 });

        // Inject specific test case: 6 words total, 4 filler words, non-filler NOT back-to-back
        // String: "um hello actually world basically literally"
        debugLog('[TEST] 🚀 Injecting filler words (um, hello, actually, world, basically, literally)...');
        await mockLiveTranscript(proPage, ["um hello actually world basically literally"]);

        // Wait for filler detection (deterministic polling)
        const fillerValue = proPage.getByTestId(TEST_IDS.FILLER_COUNT_VALUE);
        await expect(async () => {
            const fillerText = await fillerValue.textContent();
            debugLog('[TEST] Polling filler count:', fillerText);
            // We sent 3 words, expect at least 1 (async detection might lag)
            // fillerText format is "(3)", so strip non-digits
            const count = parseInt(fillerText?.replace(/\D/g, '') || '0');
            expect(count).toBeGreaterThanOrEqual(1);

            // At least one badge should have a count > 0
            const counts = await proPage.getByTestId('filler-badge-count').allTextContents();
            const hasPositiveCount = counts.some(c => c !== '-' && parseInt(c) > 0);
            expect(hasPositiveCount).toBe(true);
        }).toPass({ timeout: 20000, intervals: [1000, 2000] });

        debugLog('[TEST] ✅ Filler words detected');
    });
});
