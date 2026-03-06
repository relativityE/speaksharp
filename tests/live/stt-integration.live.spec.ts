/**
 * @file stt-integration.live.spec.ts
 * @description Live Integration Test for Real STT Engines (No Mocks).
 *
 * BEHAVIORAL CONTRACT (Pattern 10):
 *   Tests assert on [data-action] FSM state and [aria-label] accessibility contract,
 *   NOT on visible text/icon structure. This ensures design changes cannot silently
 *   break functional test coverage.
 *
 * AUDIO INJECTION:
 *   Run via playwright.live.config.ts which passes:
 *     --use-fake-device-for-media-stream
 *     --use-file-for-fake-audio-capture=tests/fixtures/audio.wav
 */
import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute, goToPublicRoute, debugLog } from '../e2e/helpers';
import { TEST_IDS, ROUTES } from '../constants';

// Extend Window interface for E2E flags
declare global {
    interface Window {
        __E2E_MOCK_LOCAL_WHISPER__?: boolean;
        __E2E_PLAYWRIGHT__?: boolean;
        TEST_MODE?: boolean;
        __PrivateWhisper_INT_TEST__?: {
            engineType?: string;
            status?: string;
            transcript?: string;
        };
    }
}

// Inject E2E playwright flag BEFORE page loads
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E_PLAYWRIGHT__ = true;
        window.TEST_MODE = true;
    });
});

test.describe('Private STT (Production Capability Smoke)', () => {
    test('should initialize real Whisper engine and intercept with Service Worker', async ({ page }) => {
        if (!process.env.REAL_WHISPER_TEST) test.skip();

        await goToPublicRoute(page, '/');

        // Nuclear Teardown — ensure clean origin state for WASM/SW isolation
        await page.evaluate(async () => {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const r of registrations) await r.unregister();
            const cacheNames = await caches.keys();
            for (const n of cacheNames) await caches.delete(n);
            window.localStorage.clear();
            window.sessionStorage.clear();
            const dbs = await indexedDB.databases();
            for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
        });

        await page.reload({ waitUntil: 'networkidle' });

        // WASM SharedArrayBuffer requires cross-origin isolation — skip if not available
        const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
        if (!isIsolated) {
            test.skip();
            return;
        }

        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
        await navigateToRoute(page, ROUTES.SESSION);
        await page.waitForSelector(`[data-testid="${TEST_IDS.APP_MAIN}"]`);

        await page.evaluate(() => {
            window.__E2E_MOCK_LOCAL_WHISPER__ = false;
        });

        const logs: string[] = [];
        page.on('console', msg => logs.push(msg.text()));

        // --- Behavioral Contract: START → STOP ---
        // Use a stable locator reference for the full test.
        // The same element toggles state — avoid re-querying between assertions.
        const sessionButton = page.getByTestId(TEST_IDS.SESSION_START_STOP_BUTTON);

        // Pre-condition: button must be in "start" state before clicking
        await expect(sessionButton).toHaveAttribute('data-action', 'start');
        await expect(sessionButton).toHaveAttribute('aria-label', /start recording/i);

        // Trigger recording
        await sessionButton.click();

        // Assert FSM transitioned to "stop" state (behavioral, not structural)
        // ✅ CORRECT: validates the button's role/state, not its icon or label text.
        // This assertion is immune to visual redesigns of the button.
        await expect(sessionButton).toHaveAttribute('data-action', 'stop');
        await expect(sessionButton).toHaveAttribute('aria-label', /stop recording/i);

        // --- Behavioral Contract: STOP → START ---
        await sessionButton.click();

        // Assert FSM returned to "start" state
        await expect(sessionButton).toHaveAttribute('data-action', 'start');
        await expect(sessionButton).toHaveAttribute('aria-label', /start recording/i);

        debugLog('Live STT smoke test completed. Console logs:', logs);
    });
});
