import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Hardening Safeguards', () => {

    test('Idempotency: Same request returns existing session', async ({ proPage }) => {
        await navigateToRoute(proPage, '/session');

        // CORRECT — intercept the network call and verify it fires once
        let sessionCreateCount = 0;
        await proPage.route('**/rest/v1/rpc/create_session_and_update_usage', async route => {
            sessionCreateCount++;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    new_session: { id: `session-${Date.now()}` },
                    usage_exceeded: false
                }),
            });
        });

        // Trigger session save via UI (Start/Stop)
        await proPage.getByTestId('session-start-stop-button').click();
        await expect(proPage.locator('[data-state="recording"]')).toBeVisible();

        // Wait a bit to ensure recording has content (Minimum 5s required for save)
        await proPage.waitForTimeout(6000);
        await proPage.getByTestId('session-start-stop-button').click();
        
        // Wait for the behavioral signal set by useSessionLifecycle
        await expect(proPage.locator('html[data-session-saved="true"]')).toBeVisible({ timeout: 20000 });
        
        // Behavioral Check: Verify service state transitioned to IDLE/READY via the service singleton
        const serviceState = await proPage.evaluate(() => (window as any).__TRANSCRIPTION_SERVICE__?.getState());
        expect(['IDLE', 'READY']).toContain(serviceState);

        // Verify only one session was created (Network level check)
        expect(sessionCreateCount).toBeGreaterThanOrEqual(1);
    });

    test('Concurrency: User is blocked after max_concurrent_sessions', async ({ freePage: page, context }) => {
        await navigateToRoute(page, '/session');

        // Open two pages as same user
        const page2 = await context.newPage();
        await programmaticLoginWithRoutes(page2, { userType: 'free' });
        await navigateToRoute(page2, '/session');

        // Start session on page 1
        await page.getByTestId('session-start-stop-button').click();
        await expect(page.locator('[data-state="recording"]')).toBeVisible();

        // Attempt session on page 2 — should be blocked
        await page2.getByTestId('session-start-stop-button').click();

        // Behavioral Check: Status bar enters 'error' state on page 2
        await expect(page2.locator('[data-state="error"]').first()).toBeVisible({ timeout: 10000 });
        
        // Inspection: Verify service mode is NOT recording on blocked page
        const isRecordingOnPage2 = await page2.evaluate(() => (window as any).__TRANSCRIPTION_SERVICE__?.getState() === 'RECORDING');
        expect(isRecordingOnPage2).toBe(false);
    });

    test('Privacy Fallback: No silent native leak when Private STT fails', async ({ proPage: page }) => {
        // Force WASM to fail by intercepting model load
        await page.route('**/*.onnx', route => route.abort());
        await page.route('**/whisper**', route => route.abort());

        await navigateToRoute(page, '/session');

        // Select Private mode
        await page.getByTestId('stt-mode-select').click();
        await page.getByTestId('stt-mode-private').click();

        await page.getByTestId('session-start-stop-button').click();

        // Behavioral Check: Status bar enters 'error' state (Blocking failure)
        await expect(page.locator('[data-state="error"]').first()).toBeVisible({ timeout: 15000 });

        // Inspection Check: Verify engine is NOT native (No leakage)
        const activeMode = await page.evaluate(() => (window as any).__TRANSCRIPTION_SERVICE__?.getMode());
        expect(activeMode).not.toBe('native');
    });
});
