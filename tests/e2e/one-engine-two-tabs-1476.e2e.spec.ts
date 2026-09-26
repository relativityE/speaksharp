/**
 * #1476 PM disposition on 039043877 — ONE ACCOUNT, ONE ENGINE, in TWO REAL BROWSER TABS.
 *
 * Two pages of one browser context (the same origin and account, as two tabs are) share ONE recording lease through the
 * opt-in shared double (`window.__E2E_SHARED_LEASE_1476__`, setupE2EManifest.ts) that applies the server's lease rules.
 * Every step asserts what each tab's engine actually is, not an RPC result:
 *  - the controller's state and its TranscriptionService's OWN state (`__SPEECH_RUNTIME_DEBUG__`),
 *  - whether that service still HOLDS a microphone handle (`controller.service.mic`),
 *  - the copy on screen.
 * The server-side fence for the same sequences is proven on real PostgreSQL (tests/db/run-one-active-engine-realpg.sh).
 *
 * NOT covered here, stated plainly:
 *  - a physical microphone: E2E builds inject a narrow mic stub (STTServiceFactory / TranscriptionService `mockMic`), so
 *    no hardware MediaStreamTrack exists to observe. What is asserted is that the engine lets go of its mic handle;
 *    that a real MicStream's stop ends its tracks is `audioUtils.impl.ts` (`stopAndClose`).
 *  - a tab running the pre-#1525 bundle (a browser cannot run the old build in this suite) — see
 *    frontend/src/services/__tests__/oldTabRollout1476.test.ts for that rollout contract.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, startRecording, waitForModelReady } from './helpers';

const BLOCKED = /A recording is active on .+\. Stop it there, or press Start again to take over here/;
const DISPLACED = 'This recording stopped because another device took over. What was recorded here is being saved.';
/** The same-browser tab lock (pre-#1476) may answer first between two tabs of ONE browser; either refusal is truthful. */
const SAME_BROWSER_TAB = 'Active session in another tab. Switch to that tab to continue.';
const PROGRESS_HELD = 'Finishing up your last session — this will retry automatically. You can start again once it completes.';

/** Opt this tab into the shared lease — for future documents AND the one already loaded (the auth fixtures load the app first). */
async function optIntoSharedLease(page: Page) {
    await page.addInitScript(() => { (window as unknown as { __E2E_SHARED_LEASE_1476__?: boolean }).__E2E_SHARED_LEASE_1476__ = true; });
    await page.evaluate(() => { (window as unknown as { __E2E_SHARED_LEASE_1476__?: boolean }).__E2E_SHARED_LEASE_1476__ = true; }).catch(() => undefined);
}
type Engine = { controllerState: string | null; serviceState: string | null; micHeld: boolean };
const engine = (page: Page): Promise<Engine> => page.evaluate(() => {
    const w = window as unknown as {
        __SPEECH_RUNTIME_DEBUG__?: () => { controllerState?: string; serviceState?: string | null };
        __TRANSCRIPTION_SERVICE__?: { service?: { mic?: unknown } | null };
    };
    const dbg = w.__SPEECH_RUNTIME_DEBUG__?.() ?? {};
    return {
        controllerState: dbg.controllerState ?? null,
        serviceState: dbg.serviceState ?? null,
        micHeld: w.__TRANSCRIPTION_SERVICE__?.service?.mic != null,
    };
});
const recording = { controllerState: 'RECORDING', serviceState: 'RECORDING', micHeld: true };
const notRecording = (e: Engine) => e.controllerState !== 'RECORDING' && e.serviceState !== 'RECORDING' && !e.micHeld;

async function pressStart(page: Page) {
    await waitForModelReady(page);
    await page.getByTestId('mic-start').click();
}

test.describe('#1476 one account, one engine — two tabs', () => {
    test('take-over across tabs: the second tab is blocked, an explicit take-over moves the ONE engine, and the displaced tab\'s engine actually stops and lets go of its mic', async ({ proPage: tabA }) => {
        test.setTimeout(120_000);
        await optIntoSharedLease(tabA);
        const tabB = await tabA.context().newPage();
        await programmaticLoginWithRoutes(tabB, { userType: 'pro' });
        await optIntoSharedLease(tabB);

        await navigateToRoute(tabA, '/session');
        await startRecording(tabA);
        expect(await engine(tabA), 'tab A records, its engine holding the mic').toEqual(recording);

        // Tab B presses Start while A records: refused before any engine work.
        await navigateToRoute(tabB, '/session');
        await pressStart(tabB);
        await expect(tabB.getByText(BLOCKED)).toBeVisible({ timeout: 15_000 });
        expect(notRecording(await engine(tabB)), 'a blocked tab starts no engine and takes no mic').toBe(true);
        expect(await engine(tabA), 'tab A keeps recording').toEqual(recording);

        // The explicit take-over: tab B's second press moves the ONE engine.
        await pressStart(tabB);
        await expect.poll(() => engine(tabB), { timeout: 20_000 }).toEqual(recording);

        // Tab A learns on its next lease heartbeat, stops, lets go of its mic, and says what happened.
        await expect(tabA.getByText(DISPLACED)).toBeVisible({ timeout: 20_000 });
        await expect.poll(async () => notRecording(await engine(tabA)), { timeout: 20_000, message: 'the displaced tab\'s engine stops and releases its mic' }).toBe(true);
        expect(await engine(tabB), 'exactly one engine: tab B').toEqual(recording);

        // And now it is tab A that is refused while B records — by the account lease or, first, by this browser's own tab
        // lock (two tabs of ONE browser); either way with truthful copy and no engine.
        await pressStart(tabA);
        await expect(tabA.getByText(BLOCKED).or(tabA.getByText(SAME_BROWSER_TAB)).first()).toBeVisible({ timeout: 15_000 });
        expect(notRecording(await engine(tabA))).toBe(true);
        expect(await engine(tabB)).toEqual(recording);
    });

    test('an outstanding Progress obligation from ANOTHER device holds Start in this tab: no engine, no mic, and the copy says why', async ({ proPage: page }) => {
        test.setTimeout(90_000);
        await optIntoSharedLease(page);
        await navigateToRoute(page, '/session');
        // Just before this Start, another device records a session whose Progress is still owed and cannot be settled yet
        // (attribution not terminal: the evaluation returns NULL). This browser has never seen it; the Start's own check
        // with the server finds it. (Seeded now rather than at page load: the E2E double answers evaluations like the
        // server, so debt present at load would be retried — and released or settled — before the person presses Start.)
        await page.evaluate(() => {
            localStorage.setItem('__e2e_progress_obligations_1476', JSON.stringify([{ session_id: 'sess-other-device-1476', state: 'pending', created_at: '2026-09-23T12:00:00.000Z' }]));
        });
        await pressStart(page);
        // The Start's scan now publishes the gate (canary 36142201470), so the reason is the gate's own notice: rendered
        // in the recorder and, for small screens, in the mobile bar's blocked reason — hence the first visible match.
        await expect(page.getByText(PROGRESS_HELD).first()).toBeVisible({ timeout: 15_000 });
        expect(notRecording(await engine(page)), 'Start held before any engine work').toBe(true);
    });
});
