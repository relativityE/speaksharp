/**
 * #1258 C10 — Honest Start and repeat-take readiness (PRODUCT_REQUIREMENTS §5).
 *
 * MOCK BROWSER, labelled: the E2E build never loads the Private model, so engine setup is slowed with the test-only
 * `__SS_E2E_ENGINE_SETUP_DELAY_MS__` hook (inert in production builds; it only delays, never fakes capture). Real-frame
 * ordering of `Speak now` is proven separately on a real device. Engine creation is counted from the controller's own
 * trace (`controller_start_create_service`), not inferred from the page.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { navigateToRoute, mockLiveTranscript, programmaticLoginWithRoutes, startRecording, stopRecording } from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

const GETTING_READY = 'Getting your mic ready…';
const TAKING_LONGER = 'This is taking longer than usual.';

const setDelay = (page: Page, ms: number) => page.evaluate((d) => {
    (window as unknown as { __SS_E2E_ENGINE_SETUP_DELAY_MS__?: number }).__SS_E2E_ENGINE_SETUP_DELAY_MS__ = d;
}, ms);
const armTrace = (page: Page) => page.evaluate(() => {
    (window as unknown as { __NATIVE_BROWSER_TRACE__?: unknown[] }).__NATIVE_BROWSER_TRACE__ = [];
});
const serviceCreations = (page: Page) => page.evaluate(() =>
    ((window as unknown as { __NATIVE_BROWSER_TRACE__?: Array<{ event: string }> }).__NATIVE_BROWSER_TRACE__ ?? [])
        .filter((e) => e.event === 'controller_start_create_service').length);
const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);

async function completeOneTake(page: Page) {
    await startRecording(page);
    await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(5_200);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
}

test.describe('#1258 C10 — Honest Start (mock browser, engine setup delayed)', () => {
    test('Practice again?: Starting… at once, Getting your mic ready…, no stale copy or live indicator, then Speak now', async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: 1280, height: 800 });
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/session');
        await completeOneTake(page);
        const again = page.getByTestId('verdict-practice-again');
        await expect(again).toBeEnabled({ timeout: 15_000 });

        await setDelay(page, 6_000);
        await again.click();
        await page.waitForTimeout(300);
        await expect(again).toHaveText('Starting…');
        await expect(again).toBeDisabled();
        let text = await bodyText(page);
        expect(text).toContain(GETTING_READY);
        expect(text).not.toContain('Session saved.');
        expect(text).not.toContain('Finalizing your transcript');
        await expect(page.getByTestId('post-save-review-session-link')).toHaveCount(0);
        await expect(page.getByTestId('recorder-bar')).toHaveCount(0);

        await page.waitForTimeout(2_700); // ~3 s after the press: still the same honest wait
        text = await bodyText(page);
        expect(text).toContain(GETTING_READY);
        await expect(page.getByTestId('recorder-bar')).toHaveCount(0);

        // Recording begins: the live state, with its own status — never the previous take's.
        await expect(page.getByTestId('recorder-bar')).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => bodyText(page), { timeout: 5_000 }).toContain('Speak now');
        text = await bodyText(page);
        expect(text, 'Speak now takes the live slot; the generic copy is gone').not.toContain('Recording active');
        expect(text).not.toContain('Finalizing your transcript');
        expect(text).not.toContain(GETTING_READY);
    });

    test('Start recording (first take): Starting…, "Mic ready on this device" hidden, Getting your mic ready…', async ({ page }) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width: 1280, height: 800 });
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/session');
        const start = page.getByTestId('mic-start');
        await expect(start).toBeEnabled({ timeout: 30_000 });
        await expect(page.getByTestId('mic-status')).toBeVisible();

        await setDelay(page, 6_000);
        await start.click();
        await page.waitForTimeout(300);
        await expect(start).toContainText('Starting…');
        await expect(start).toBeDisabled();
        await expect(page.getByTestId('mic-status')).toHaveCount(0);
        expect(await bodyText(page)).toContain(GETTING_READY);
        await expect(page.getByTestId('recorder-bar')).toHaveCount(0);

        await expect(page.getByTestId('recorder-bar')).toBeVisible({ timeout: 15_000 });
    });

    test('RECORDING without real-frame readiness shows NO live cue; the engine\'s readiness makes the single live moment', async ({ page }) => {
        test.setTimeout(60_000);
        await page.setViewportSize({ width: 1280, height: 800 });
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/session');
        const start = page.getByTestId('mic-start');
        await expect(start).toBeEnabled({ timeout: 30_000 });
        // Hold the labelled mock readiness stimulus so the runtime reaches RECORDING with NO real frames.
        await page.evaluate(() => { (window as unknown as { __SS_E2E_HOLD_CAPTURE_READY__?: boolean }).__SS_E2E_HOLD_CAPTURE_READY__ = true; });
        await start.click();
        await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 15_000 });
        await page.waitForTimeout(1_000);
        await expect(page.getByTestId('recorder-bar'), 'no recording bar / timer / waveform before real frames').toHaveCount(0);
        expect(await bodyText(page)).toContain(GETTING_READY);
        expect(await bodyText(page), 'Speak now waits for real frames').not.toContain('Speak now');
        await expect(start).toContainText('Starting…');

        // Deliver the engine's own readiness (what the real gate fires) — the one live moment.
        await page.evaluate(() => {
            const w = window as unknown as { __PrivateWhisper_INT_TEST__?: { onStatusChange?: (s: { type: string; message: string }) => void } };
            w.__PrivateWhisper_INT_TEST__?.onStatusChange?.({ type: 'recording', message: 'Speak now' });
        });
        await expect(page.getByTestId('recorder-bar')).toBeVisible({ timeout: 5_000 });
        await expect.poll(() => bodyText(page), { timeout: 5_000 }).toContain('Speak now');
        expect(await bodyText(page)).not.toContain(GETTING_READY);
        expect(await bodyText(page), 'no Speak now before real frames, and no generic copy after').not.toContain('Recording active');
    });

    test('10 s from the press: the notice and Try again; Try again cancels with confirmed release and starts exactly one engine', async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width: 1280, height: 800 });
        await programmaticLoginWithRoutes(page, { userType: 'pro' });
        await navigateToRoute(page, '/session');
        const start = page.getByTestId('mic-start');
        await expect(start).toBeEnabled({ timeout: 30_000 });

        await armTrace(page);
        await setDelay(page, 30_000);
        await start.click();
        await page.waitForTimeout(9_000);
        expect(await bodyText(page)).not.toContain(TAKING_LONGER); // not before 10 s
        await expect(page.getByTestId('startup-try-again')).toHaveCount(0);

        await expect.poll(() => bodyText(page), { timeout: 3_000 }).toContain(TAKING_LONGER);
        const retry = page.getByTestId('startup-try-again');
        await expect(retry).toBeVisible();
        const before = await serviceCreations(page);

        await setDelay(page, 0); // the replacement start is not slowed
        await retry.click();
        await expect(page.getByTestId('recorder-bar')).toBeVisible({ timeout: 20_000 });
        expect(await serviceCreations(page) - before, 'Try again creates exactly one replacement engine').toBe(1);
        const text = await bodyText(page);
        expect(text).not.toContain(TAKING_LONGER);
        expect(text).not.toContain(GETTING_READY);
    });
});
