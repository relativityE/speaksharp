/**
 * Production canary 36142201470, attempt 1 (#1521 verification, PM classification: pre-RWT) — a Start pressed while the
 * account's owed Progress evaluations are still SETTLING.
 *
 * Observed on Production: the click took the recording lease, the lease was released a moment later while the owed
 * evaluations finished (all 200), and then nothing happened — no model download, no session, no network for 150 s —
 * while the page kept saying "Finishing up your last session — … You can start again once it completes." with Start
 * enabled, although nothing was owed any more.
 *
 * This journey reproduces that window deterministically: the account owes one evaluation, the server's
 * `record_progress_evaluation` is HELD (the E2E double's opt-in switch, as in start-journeys-1476), the person presses
 * Start during the hold, then the evaluation is released and settles. The acceptable outcome (PM):
 *   1. the first click is handled TRUTHFULLY — no recording, no microphone, the lease it took is released, and the page
 *      says why;
 *   2. once the debt settles, the notice CLEARS on its own (no stale "Finishing up");
 *   3. the NEXT Start records, with no reload.
 * The oracle is the rendered page, the engine's own state and mic handle, the lease, and the RPCs the page made.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { navigateToRoute, simulateTranscription, startRecording, stopRecording, waitForModelReady } from './helpers';

const MIC_READY = 'Mic ready on this device';
const PROGRESS_HELD = 'Finishing up your last session — this will retry automatically. You can start again once it completes.';
const LEASE_KEY = '__e2e_shared_lease_1476';
const OBLIGATIONS_KEY = '__e2e_progress_obligations_1476';

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

test.describe('Start pressed while owed Progress is settling (canary 36142201470)', () => {
    test('debt FOUND AT Start: refused truthfully, the owed evaluation is retried and settles, the notice clears, the next Start records without a reload', async ({ proPage: page }) => {
        test.setTimeout(180_000);
        await optIn(page);
        await navigateToRoute(page, '/session');
        await waitForModelReady(page);
        await expect(page.getByTestId('mic-status')).toContainText(MIC_READY, { timeout: 15_000 });

        // The account owes one evaluation, and the server's evaluation call will be held open while it settles.
        await page.evaluate((key) => localStorage.setItem(key, JSON.stringify([
            { session_id: 'sess-settle-window', state: 'owed', created_at: '2026-09-25T13:39:00.000Z' },
        ])), OBLIGATIONS_KEY);
        await hold(page, 'record_progress_evaluation', true);
        const sessionsBefore = await calls(page, 'create_session_and_update_usage');

        // ── The person presses Start during the settling window ────────────────────────────────────────────
        await page.getByTestId('mic-start').click();

        // 1. Handled truthfully: never records, no microphone, the lease it took is released, and the page says why.
        for (let i = 0; i < 8; i += 1) {
            expect(notRecording(await engine(page)), 'no recording while Progress is settling').toBe(true);
            await page.waitForTimeout(250);
        }
        expect(await calls(page, 'create_session_and_update_usage'), 'no session was created for the refused Start').toBe(sessionsBefore);
        await expect.poll(() => leaseHeld(page), { timeout: 10_000, message: 'the refused Start leaves no lease held' }).toBe(false);
        await expect(page.getByText(PROGRESS_HELD).first(), 'the page says why Start is waiting').toBeVisible({ timeout: 10_000 });

        // ── The evaluation completes ─────────────────────────────────────────────────────────────────────────
        // The page's bounded retry decides WHEN it calls; the call is held until released here, then recorded.
        await expect.poll(() => heldNow(page, 'record_progress_evaluation'), { timeout: 60_000, message: 'the bounded retry really calls the server' }).toBe(true);
        await hold(page, 'record_progress_evaluation', false);
        await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), OBLIGATIONS_KEY), { timeout: 30_000, message: 'the server records the owed evaluation' }).toBe('[]');

        // 2. The notice clears on its own — no stale "Finishing up" once nothing is owed.
        await expect(page.getByText(PROGRESS_HELD), 'the Progress notice clears after the debt settles').toHaveCount(0, { timeout: 15_000 });
        await expect(page.getByTestId('mic-status')).toContainText(MIC_READY, { timeout: 15_000 });

        // 3. The next Start records, with no reload.
        await page.getByTestId('mic-start').click();
        await expect.poll(async () => (await engine(page)).controllerState, { timeout: 30_000, message: 'the next Start records without a reload' }).toBe('RECORDING');
    });

    test('debt found AT LOAD and still settling: Start is truthfully blocked, the notice clears on settle, and the next Start records without a reload', async ({ proPage: page }) => {
        test.setTimeout(180_000);
        await optIn(page);
        // The account already owes one evaluation when the page loads, and the page's own load-time evaluation is held
        // from its first instant.
        await page.evaluate((key) => localStorage.setItem(key, JSON.stringify([
            { session_id: 'sess-settle-at-load', state: 'owed', created_at: '2026-09-25T13:39:00.000Z' },
        ])), OBLIGATIONS_KEY);
        await page.addInitScript(() => {
            const w = window as unknown as { __E2E_HOLD_RPC_1476__?: Record<string, boolean> };
            if (sessionStorage.getItem('__settle_hold_released') !== '1') {
                w.__E2E_HOLD_RPC_1476__ = { ...(w.__E2E_HOLD_RPC_1476__ ?? {}), record_progress_evaluation: true };
            }
        });
        await navigateToRoute(page, '/session');
        await page.reload();
        await expect.poll(() => heldNow(page, 'record_progress_evaluation'), { timeout: 30_000, message: 'the load-time evaluation of the owed session is in flight' }).toBe(true);

        // PRECONDITION (PM): the Start gate genuinely sees same-owner owed debt, still inside its retry bound. (A hold
        // that never completes is released by the bounded retry at ~60 s by design, after which Start is allowed — so
        // this is asserted, not assumed.)
        const gateNow = () => page.evaluate(() => {
            const w = window as unknown as { __SESSION_STORE_API__?: { getState: () => { progressGate?: { ownerId?: string | null; state?: string } | null; progressGateResolvedFor?: string | null } } };
            const st = w.__SESSION_STORE_API__?.getState();
            const entries = Object.keys(localStorage).filter((k) => k.startsWith('ss_progress_reconcile_queue'))
                .map((k) => JSON.parse(localStorage.getItem(k) ?? '{}') as { releasedAtIso?: string });
            return { state: st?.progressGate?.state ?? null, sameOwner: Boolean(st?.progressGate?.ownerId) && st?.progressGate?.ownerId === st?.progressGateResolvedFor,
                unreleased: entries.length > 0 && entries.every((e) => !e.releasedAtIso) };
        });
        await expect.poll(gateNow, { timeout: 15_000, message: 'precondition: same-owner queued debt, unreleased' })
            .toEqual({ state: 'queued', sameOwner: true, unreleased: true });

        // Truthful blocked state: Start cannot be pressed, the page says why, nothing records and no lease is held.
        const startControl = page.getByTestId('mic-start').or(page.getByTestId('mic-download')).first();
        await expect(startControl, 'Start is blocked while Progress is settling').toBeDisabled({ timeout: 15_000 });
        await expect(page.getByText(/Finishing up your last session/).first(), 'the page says why Start is waiting').toBeVisible({ timeout: 10_000 });
        expect(notRecording(await engine(page))).toBe(true);
        expect(await leaseHeld(page), 'no lease while blocked').toBe(false);

        // ── The evaluation completes ─────────────────────────────────────────────────────────────────────────
        await page.evaluate(() => sessionStorage.setItem('__settle_hold_released', '1'));
        await hold(page, 'record_progress_evaluation', false);
        await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), OBLIGATIONS_KEY), { timeout: 30_000, message: 'the server records the owed evaluation' }).toBe('[]');

        // The notice clears on its own, Start is available, and the next click records — no reload.
        await expect(page.getByText(/Finishing up your last session/), 'the Progress notice clears after the debt settles').toHaveCount(0, { timeout: 15_000 });
        await expect(page.getByTestId('mic-status')).toContainText(MIC_READY, { timeout: 15_000 });
        await page.getByTestId('mic-start').or(page.getByTestId('mic-download')).first().click();
        await expect.poll(async () => (await engine(page)).controllerState, { timeout: 30_000, message: 'the next Start records without a reload' }).toBe('RECORDING');
    });

    /**
     * #1533 Codex P2 (PM FIX NOW) — the AFTER-SESSION desktop path. A take saves while its Progress evaluation is held,
     * so the gate is genuinely queued on the after-session screen. #1533 removes the refusal copy from the recorder
     * status once the gate is published; the held after-session mic must still say why, exactly once.
     */
    test('after-session "Practice again" while Progress is settling: the held mic says why (once), nothing records, the notice clears and the next Start records', async ({ proPage: page }) => {
        test.setTimeout(180_000);
        await optIn(page);
        await navigateToRoute(page, '/session');
        await waitForModelReady(page);
        await expect(page.getByTestId('mic-status')).toContainText(MIC_READY, { timeout: 15_000 });

        // A real take, saved normally. (The just-saved session's own evaluation never holds the next Start — that is
        // the RWT "no false Finishing up" rule; only OWED debt does.)
        await startRecording(page);
        await simulateTranscription(page, 'Today I will explain the plan in three clear steps for the team.', true);
        await page.waitForTimeout(5_200);
        await stopRecording(page);
        await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
        await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) ?? '[]', OBLIGATIONS_KEY), { timeout: 30_000, message: 'the saved take evaluated' }).toBe('[]');

        // Then the account owes an evaluation, and the server's evaluation call is held while it settles.
        await page.evaluate((key) => localStorage.setItem(key, JSON.stringify([
            { session_id: 'sess-after-owed', state: 'owed', created_at: '2026-09-25T13:39:00.000Z' },
        ])), OBLIGATIONS_KEY);
        await hold(page, 'record_progress_evaluation', true);
        const sessionsAfterSave = await calls(page, 'create_session_and_update_usage');

        // The person presses "Practice again" on the after-session screen; the Start-time scan finds the owed debt.
        await page.getByTestId('verdict-practice-again').click();
        for (let i = 0; i < 8; i += 1) {
            expect(notRecording(await engine(page)), 'no recording while Progress is settling').toBe(true);
            await page.waitForTimeout(250);
        }
        expect(await calls(page, 'create_session_and_update_usage'), 'no session was created for the held Start').toBe(sessionsAfterSave);
        await expect.poll(() => leaseHeld(page), { timeout: 10_000, message: 'the held Start leaves no lease held' }).toBe(false);

        // The held after-session mic says why — beside the mic, and exactly ONE visible copy on desktop.
        await expect(page.getByTestId('run-shape-mic'), 'the after-session mic is held').toBeDisabled({ timeout: 10_000 });
        await expect(page.getByTestId('run-shape-blocked-reason'), 'the held mic says why').toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('run-shape-blocked-reason')).toContainText(/Finishing up your last session/);
        await expect(page.getByTestId('mobile-start-blocked-reason'), 'the phone bar copy is not shown on desktop').toBeHidden();
        await expect.poll(() => page.getByText(/Finishing up your last session/).evaluateAll(
            (nodes) => nodes.filter((n) => (n as HTMLElement).offsetParent !== null).length,
        ), { message: 'exactly one visible notice (no duplicate red refusal copy)' }).toBe(1);

        // ── The evaluation completes ─────────────────────────────────────────────────────────────────────────
        await expect.poll(() => heldNow(page, 'record_progress_evaluation'), { timeout: 60_000, message: 'the bounded retry really calls the server' }).toBe(true);
        await hold(page, 'record_progress_evaluation', false);
        await expect.poll(() => page.evaluate((key) => localStorage.getItem(key) ?? '[]', OBLIGATIONS_KEY), { timeout: 60_000, message: 'nothing is owed any more' }).toBe('[]');

        // The notice clears on its own (no stale copy), the mic is available, and the next Start records — no reload.
        await expect(page.getByText(/Finishing up your last session/), 'the notice clears after the debt settles').toHaveCount(0, { timeout: 30_000 });
        await expect(page.getByTestId('run-shape-mic')).toBeEnabled({ timeout: 15_000 });
        await page.getByTestId('run-shape-mic').click();
        await expect.poll(async () => (await engine(page)).controllerState, { timeout: 30_000, message: 'the next Start records without a reload' }).toBe('RECORDING');
    });
});
