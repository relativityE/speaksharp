/**
 * #1476 PM directive on 0200e7829 — the two user journeys #1525 must get right, driven in a real browser.
 *
 *  1. A person presses Start and LEAVES while the Start is still checking with the server (lease or saved-session
 *     check in flight). When that answer arrives later, the recording must not start: no engine, no microphone handle,
 *     the person stays where they went, and the lease the abandoned Start took is released.
 *  2. The saved-session check at Start is SLOW (longer than the Start's 5 s wait). The person is told so truthfully,
 *     and when the answer lands later the page reconciles without a reload: debt it found shows the Progress notice
 *     and its bounded retry really calls the server; nothing owed returns the page to rest (the wait copy is gone, the
 *     mic card says the mic is ready) and Start then records.
 *
 * The oracle is the rendered page and the next action, never an internal status: the idle status bar is intentionally
 * hidden (SessionPage), and the at-rest cue is the mic card's `mic-status`.
 *
 * The in-flight server calls are held by the E2E double's opt-in switch (`__E2E_HOLD_RPC_1476__`, setupE2EManifest.ts)
 * and released by the spec, so each call is genuinely pending across the navigation or the timeout. What is asserted is
 * what the person experiences — the engine's own state and mic handle (`__SPEECH_RUNTIME_DEBUG__`,
 * `__TRANSCRIPTION_SERVICE__`), the URL and page they see, and the copy on screen — plus the RPCs the page really made.
 * As in one-engine-two-tabs-1476.e2e.spec.ts, E2E builds use a mic stub, so the mic evidence is the engine's handle.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { navigateToRoute, waitForModelReady } from './helpers';

const SLOW = 'Checking your saved sessions is taking longer than usual. Press Start again in a moment.';
const MIC_READY = 'Mic ready on this device';
const PROGRESS_HELD = 'Finishing up your last session — this will retry automatically. You can start again once it completes.';
const LEASE_KEY = '__e2e_shared_lease_1476';

type Engine = { controllerState: string | null; serviceState: string | null; micHeld: boolean };
const engine = (page: Page): Promise<Engine> => page.evaluate(() => {
    const w = window as unknown as {
        __SPEECH_RUNTIME_DEBUG__?: () => { controllerState?: string; serviceState?: string | null };
        __TRANSCRIPTION_SERVICE__?: { service?: { mic?: unknown } | null };
    };
    const dbg = w.__SPEECH_RUNTIME_DEBUG__?.() ?? {};
    return { controllerState: dbg.controllerState ?? null, serviceState: dbg.serviceState ?? null, micHeld: w.__TRANSCRIPTION_SERVICE__?.service?.mic != null };
});
const notRecording = (e: Engine) => e.controllerState !== 'RECORDING' && e.serviceState !== 'RECORDING' && !e.micHeld;

async function optIn(page: Page) {
    await page.addInitScript(() => { (window as unknown as { __E2E_SHARED_LEASE_1476__?: boolean }).__E2E_SHARED_LEASE_1476__ = true; });
    await page.evaluate(() => { (window as unknown as { __E2E_SHARED_LEASE_1476__?: boolean }).__E2E_SHARED_LEASE_1476__ = true; }).catch(() => undefined);
}
const hold = (page: Page, fn: string, on: boolean) => page.evaluate(([name, value]) => {
    const w = window as unknown as { __E2E_HOLD_RPC_1476__?: Record<string, boolean> };
    w.__E2E_HOLD_RPC_1476__ = { ...(w.__E2E_HOLD_RPC_1476__ ?? {}), [name as string]: value as boolean };
}, [fn, on] as const);
const heldNow = (page: Page, fn: string) => page.evaluate((name) =>
    ((window as unknown as { __E2E_HELD_RPC_1476__?: string[] }).__E2E_HELD_RPC_1476__ ?? []).includes(name), fn);
const calls = (page: Page, fn: string) => page.evaluate((name) =>
    (window as unknown as { __E2E_RPC_CALLS_1476__?: Record<string, number> }).__E2E_RPC_CALLS_1476__?.[name] ?? 0, fn);
const leaseHeld = (page: Page) => page.evaluate((key) => localStorage.getItem(key) !== null, LEASE_KEY);

/** Engine samples over `ms`: the recording must NEVER start in that window, not merely be off at one instant. */
async function neverRecordsFor(page: Page, ms: number) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const e = await engine(page);
        expect(notRecording(e), `engine after the person left: ${JSON.stringify(e)}`).toBe(true);
        await page.waitForTimeout(250);
    }
}

test.describe('#1476 Start journeys: leaving mid-Start, and a slow saved-session check', () => {
    for (const heldCall of ['acquire_recording_lease', 'get_progress_obligations'] as const) {
        test(`leaving while the Start waits on ${heldCall}: no engine, no mic, the person stays where they went, the lease is released`, async ({ proPage: page }) => {
            test.setTimeout(90_000);
            await optIn(page);
            await navigateToRoute(page, '/session');
            await waitForModelReady(page);
            await hold(page, heldCall, true);
            await page.getByTestId('mic-start').click();
            await expect.poll(() => heldNow(page, heldCall), { timeout: 15_000, message: `${heldCall} is in flight` }).toBe(true);
            const sessionsCreatedBefore = await calls(page, 'create_session_and_update_usage');

            // The person leaves through the app's own navigation (a client-side route change, not a reload).
            await page.getByTestId('nav-products-button').click();
            await page.getByTestId('nav-products-focus-points').click();
            await page.waitForURL((url) => url.pathname === '/practice');
            // The server answers AS the person leaves — while the session page can still be mounted in its exit transition.
            await hold(page, heldCall, false);
            // What the person sees there: the Focus Points setup (the rail appears only after it is completed).
            await expect(page.getByRole('heading', { name: 'Set your Focus Points' }).first()).toBeVisible({ timeout: 15_000 });
            await neverRecordsFor(page, 4_000);
            // Not even briefly: a Start the person left never reaches the server as a recording.
            expect(await calls(page, 'create_session_and_update_usage'), 'no session is created for the abandoned Start').toBe(sessionsCreatedBefore);
            expect(new URL(page.url()).pathname, 'the person is still where they went').toBe('/practice');
            await expect(page.getByTestId('session-page')).toHaveCount(0);
            await expect.poll(() => leaseHeld(page), { timeout: 10_000, message: 'the abandoned Start releases the lease it took' }).toBe(false);
            expect(await calls(page, 'release_recording_lease')).toBeGreaterThan(0);

            // Coming back: close the Focus Points setup (it is modal), return to Open Mic — the page is at rest, Start works.
            await page.keyboard.press('Escape');
            await expect(page.getByRole('heading', { name: 'Set your Focus Points' })).toHaveCount(0);
            await page.getByTestId('nav-products-button').click();
            await page.getByTestId('nav-products-open-mic').click();
            await page.waitForURL((url) => url.pathname === '/session');
            await waitForModelReady(page);
            await expect(page.getByTestId('mic-status')).toContainText(MIC_READY, { timeout: 15_000 });
            await page.getByTestId('mic-start').click();
            await expect.poll(async () => (await engine(page)).controllerState, { timeout: 30_000, message: 'Start records on return' }).toBe('RECORDING');
        });
    }

    test('a slow saved-session check that later FINDS debt: truthful wait copy, then the Progress notice and a retry that really runs', async ({ proPage: page }) => {
        test.setTimeout(90_000);
        await optIn(page);
        await navigateToRoute(page, '/session');
        await waitForModelReady(page);
        await hold(page, 'get_progress_obligations', true);
        await page.getByTestId('mic-start').click();

        await expect(page.getByText(SLOW)).toBeVisible({ timeout: 15_000 });
        expect(notRecording(await engine(page)), 'no engine while the check is unresolved').toBe(true);
        await expect.poll(() => leaseHeld(page), { timeout: 10_000 }).toBe(false);

        // The late answer reports debt recorded on another device.
        await page.evaluate(() => localStorage.setItem('__e2e_progress_obligations_1476', JSON.stringify([
            { session_id: 'sess-slow-1476', state: 'owed', created_at: '2026-09-24T12:00:00.000Z' },
        ])));
        const before = await calls(page, 'record_progress_evaluation');
        await hold(page, 'get_progress_obligations', false);
        await expect(page.getByText(PROGRESS_HELD).first()).toBeVisible({ timeout: 15_000 }); // desktop and mobile both render it
        await expect.poll(() => calls(page, 'record_progress_evaluation'), { timeout: 20_000, message: 'the bounded retry really calls the server' }).toBeGreaterThan(before);
        expect(notRecording(await engine(page))).toBe(true);
    });

    test('a slow saved-session check that later finds NOTHING owed: truthful wait copy, then Start is available and records', async ({ proPage: page }) => {
        test.setTimeout(90_000);
        await optIn(page);
        await navigateToRoute(page, '/session');
        await waitForModelReady(page);
        await hold(page, 'get_progress_obligations', true);
        await page.getByTestId('mic-start').click();
        await expect(page.getByText(SLOW)).toBeVisible({ timeout: 15_000 });
        expect(notRecording(await engine(page))).toBe(true);

        await hold(page, 'get_progress_obligations', false);
        await expect(page.getByText(SLOW), 'the wait copy is gone once the check has answered').toHaveCount(0, { timeout: 15_000 });
        await expect(page.getByTestId('mic-status')).toContainText(MIC_READY);
        await page.getByTestId('mic-start').click();
        await expect.poll(async () => (await engine(page)).controllerState, { timeout: 30_000, message: 'Start records after the late check' }).toBe('RECORDING');
    });
});
