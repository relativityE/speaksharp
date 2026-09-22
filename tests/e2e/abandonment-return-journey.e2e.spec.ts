/**
 * #1360 — A USER WHO ABANDONS A RECORDING AND COMES BACK MUST BE ABLE TO RECORD AGAIN.
 *
 * RED FIRST. This spec states the acceptance and is expected to FAIL on `main` until a fix lands; it is the
 * evidence for the fix proposal, not a regression guard yet.
 *
 * The journey: start a recording, close the tab mid-recording with no stop, no save and no teardown, then
 * return — in a new tab of the same browser, and separately from a fresh context (another device, or
 * cleared storage) — and press Start.
 *
 * Measured on real PostgreSQL (#1360 comments 5782310536 / 5782440398, heartbeat case confirmed by PM):
 * the abandoned row stays `active` until `expires_at`; the first heartbeat sets that to now + 5 minutes; a
 * trial account allows ONE concurrent session. So a return inside that window is refused with
 * `max_concurrent_sessions_reached`, which the client reports as `Usage limit exceeded`.
 *
 * WHY A GATE IN THE TEST PROCESS. The E2E double keeps rows in per-tab sessionStorage and never refuses a
 * create, so against it this journey could only ever pass. The server state that locks the user out
 * outlives the tab; `ServerGate` below holds it in the test process and is exposed to every page through
 * `context.exposeBinding`, modelling the live rules (1 hour on create, 5 minutes per heartbeat, expire-then-
 * count, limit 1). No other spec installs the binding, so nothing else changes.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, mockLiveTranscript } from './helpers';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

type Row = { userId: string; sessionId: string; status: 'active' | 'completed' | 'failed'; expiresAt: number };

/** The live server's concurrency rules, held where a server holds them: outside any one tab. */
class ServerGate {
    rows: Row[] = [];
    /** Every decision the gate made, so a red result can be attributed rather than assumed. */
    log: string[] = [];
    readonly maxConcurrent = 1;                 // `free` tier — trial accounts resolve here
    readonly createTtlMs = 60 * 60_000;         // create_session_and_update_usage: now + 1 hour
    readonly heartbeatTtlMs = 5 * 60_000;       // heartbeat_session: now + 5 minutes
    private readonly now = () => Date.now();

    handle(op: string, p: Record<string, unknown>): Record<string, unknown> {
        const userId = String(p.userId ?? '');
        if (op === 'create') {
            // Expire first, then count — the server's own order.
            for (const r of this.rows) if (r.userId === userId && r.status === 'active' && r.expiresAt <= this.now()) r.status = 'failed';
            const active = this.rows.filter((r) => r.userId === userId && r.status === 'active').length;
            if (active >= this.maxConcurrent) {
                this.log.push(`create REFUSED max_concurrent_sessions_reached (active=${active})`);
                return { refused: { new_session: null, usage_exceeded: true, error: 'max_concurrent_sessions_reached', active_sessions: active, max_concurrent_sessions: this.maxConcurrent } };
            }
            this.log.push(`create allowed (active=${active})`);
            return {};
        }
        if (op === 'created') {
            this.rows.push({ userId, sessionId: String(p.sessionId), status: 'active', expiresAt: this.now() + this.createTtlMs });
            return {};
        }
        const row = this.rows.find((r) => r.sessionId === String(p.sessionId));
        if (op === 'heartbeat' && row && row.status === 'active') { row.expiresAt = this.now() + this.heartbeatTtlMs; this.log.push('heartbeat → +5 min'); }
        if (op === 'complete' && row) { row.status = p.status === 'completed' ? 'completed' : 'failed'; this.log.push(`complete → ${row.status}`); }
        return {};
    }

    activeFor(userId?: string) {
        return this.rows.filter((r) => r.status === 'active' && (!userId || r.userId === userId));
    }
}

async function installGate(context: BrowserContext, gate: ServerGate) {
    await context.exposeBinding('__e2eServerGate', (_source, op: string, payload: Record<string, unknown>) => gate.handle(op, payload));
}

/** Everything a returning user can see about the previous take and the result of pressing Start. */
async function observeReturn(page: Page) {
    const draftBefore = await page.evaluate(() => localStorage.getItem('speaksharp_unsaved_session_draft')).catch(() => null);
    await navigateToRoute(page, '/session');
    const recovery = page.getByTestId('session-recovery-actions').or(page.getByTestId('session-unresolved-recovery'));
    const recoveryVisible = await recovery.first().isVisible().catch(() => false);
    const recoveryText = recoveryVisible ? (await recovery.first().innerText()).replace(/\s+/g, ' ').trim() : null;

    const start = page.getByTestId('mic-start');
    await expect(start, 'the returning user sees a Start control').toBeVisible({ timeout: 30_000 });
    const startEnabled = await start.isEnabled();
    if (startEnabled) await start.click();

    const recordingStarted = await page
        .waitForSelector('html[data-runtime-state="RECORDING"], [data-testid="session-shell"][data-session-state="during"]', { timeout: 15_000 })
        .then(() => true, () => false);
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const usageLimitShown = /usage limit/i.test(bodyText);
    const statusText = await page.locator('[role="status"], [role="alert"], [data-sonner-toast]').allInnerTexts().catch(() => []);
    return { draftBefore: draftBefore ? JSON.parse(draftBefore).recoveryState ?? 'present' : null, recoveryVisible, recoveryText, startEnabled, recordingStarted, usageLimitShown, statusText };
}

test.describe('#1360 abandonment mid-recording → return → record again', () => {
    test('new tab, same browser: the returning user can start and save a new recording', async ({ page }) => {
        const gate = new ServerGate();
        await installGate(page.context(), gate);

        // 1. Start a recording and let it heartbeat, as every real take does within its first second.
        await programmaticLoginWithRoutes(page, { userType: 'free' });
        await navigateToRoute(page, '/session');
        await page.getByTestId('mic-start').click();
        await page.waitForSelector('html[data-runtime-state="RECORDING"], [data-testid="session-shell"][data-session-state="during"]', { timeout: 15_000 });
        await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
        await expect.poll(() => gate.activeFor().length, { message: 'the recording is an active server row', timeout: 10_000 }).toBe(1);
        await expect.poll(() => gate.activeFor()[0]?.expiresAt - Date.now() <= 5 * 60_000 + 5_000, {
            message: 'the first heartbeat reset expiry to ~5 minutes (the case a normal take is in)',
            timeout: 15_000,
        }).toBe(true);

        // 2. ABANDON: close the tab mid-recording. No stop, no save, no teardown.
        await page.close({ runBeforeUnload: true });

        // 3. Return in a new tab of the same browser.
        const back = await page.context().newPage();
        await programmaticLoginWithRoutes(back, { userType: 'free' });
        const outcome = await observeReturn(back);
        await test.info().attach('return-outcome-new-tab', { contentType: 'application/json', body: JSON.stringify({ ...outcome, activeServerRows: gate.activeFor().length, gateLog: gate.log }, null, 2) });
        console.log('RETURN-OUTCOME', JSON.stringify({ ...outcome, gateLog: gate.log }));

        // 4. THE ACCEPTANCE (#1360): truthful state, and the user can record again.
        expect(outcome.usageLimitShown, 'a trial user with time left must never be told it is a usage limit').toBe(false);
        expect(outcome.recordingStarted, 'the returning user can start a new recording').toBe(true);

        // 5. …and save it, leaving no active run-owned residue behind.
        await back.getByTestId('recorder-stop').click();
        await expect(back.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
        expect(gate.activeFor(), 'no active server rows remain after the new save').toEqual([]);
    });

    test('CONTROL: after the abandoned row has expired, the same return starts normally', async ({ page }) => {
        // Proves the red above is caused by the server lockout, not by this harness: identical journey,
        // except the abandoned row is already past `expires_at` when the user returns.
        const gate = new ServerGate();
        await installGate(page.context(), gate);
        await programmaticLoginWithRoutes(page, { userType: 'free' });
        await navigateToRoute(page, '/session');
        await page.getByTestId('mic-start').click();
        await page.waitForSelector('html[data-runtime-state="RECORDING"], [data-testid="session-shell"][data-session-state="during"]', { timeout: 15_000 });
        await expect.poll(() => gate.activeFor().length, { timeout: 10_000 }).toBe(1);
        await page.close({ runBeforeUnload: true });
        for (const r of gate.rows) r.expiresAt = Date.now() - 1_000;      // the window has passed

        const back = await page.context().newPage();
        await programmaticLoginWithRoutes(back, { userType: 'free' });
        const outcome = await observeReturn(back);
        console.log('RETURN-OUTCOME-CONTROL', JSON.stringify({ ...outcome, gateLog: gate.log }));
        expect(outcome.recordingStarted, 'with no live lock, the harness starts a recording').toBe(true);
    });

    test('fresh context (another device / cleared storage): the returning user can start and save', async ({ page, browser }) => {
        const gate = new ServerGate();
        await installGate(page.context(), gate);

        await programmaticLoginWithRoutes(page, { userType: 'free' });
        await navigateToRoute(page, '/session');
        await page.getByTestId('mic-start').click();
        await page.waitForSelector('html[data-runtime-state="RECORDING"], [data-testid="session-shell"][data-session-state="during"]', { timeout: 15_000 });
        await expect.poll(() => gate.activeFor().length, { timeout: 10_000 }).toBe(1);
        await page.close({ runBeforeUnload: true });

        // A different context shares nothing with the first — no recovery draft, no cookies — only the
        // server, which is exactly the gate.
        const other = await browser.newContext();
        await installGate(other, gate);
        const back = await other.newPage();
        await programmaticLoginWithRoutes(back, { userType: 'free' });
        const outcome = await observeReturn(back);
        await test.info().attach('return-outcome-fresh-context', { contentType: 'application/json', body: JSON.stringify({ ...outcome, activeServerRows: gate.activeFor().length, gateLog: gate.log }, null, 2) });
        console.log('RETURN-OUTCOME', JSON.stringify({ ...outcome, gateLog: gate.log }));

        expect(outcome.usageLimitShown, 'a trial user with time left must never be told it is a usage limit').toBe(false);
        expect(outcome.recordingStarted, 'the returning user can start a new recording').toBe(true);
        await other.close();
    });
});
