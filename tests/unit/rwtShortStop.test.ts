// @vitest-environment jsdom
/**
 * J1.c (Sam, 21 Nov): the short-Stop substep's probe, save tap, row reader, settle wait and row. The verdict is the nightly
 * oracle's own `shortStopVerdict` (never a copy), so these tests drive the real oracle with what the step would observe.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    J1C_LEG, J1C_ROW, SHORT_STOP_MAX_MS, SHORT_STOP_SETTLE_MS, SETTLED_DISCARD_TEXT, ShortStopSaveTap, UNSETTLED_DISCARD_TEXT, armShortStopProbe,
    awaitShortStopSettled, emptyShortStopObservation, readShortStopProbe, sessionRowsReader, shortStopInput, shortStopRow, shortStopTakeOf,
    shownFacts, stopFacts, type ShortStopObservation, type ShortStopProbeState,
} from '../live/helpers/rwtShortStop';

type Row = { step: string; verdict: string; detail: string; evidence?: Record<string, unknown> };
const sink = () => { const rows: Row[] = []; return { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, unknown>) => rows.push({ step, verdict, detail, evidence }) }; };
const plan = createRequire(import.meta.url)('../../tools/cloud-test/nightly/journey-plan.cjs') as {
    NEW_ROWS: ReadonlyArray<{ leg: string; assertion: string }>; ALL_LEGS: ReadonlyArray<{ id: string; caseId: string | null }>;
};

const SAVED = [{ id: 's1', status: 'completed' }, { id: 's2', status: 'completed' }, { id: 's3', status: 'completed' }, { id: 's4', status: 'completed' }];
/** A short Stop the product discarded and settled: its new row is marked failed, it said "too short", nothing completed. */
const good = (o: Partial<ShortStopObservation> = {}): ShortStopObservation => ({
    ...emptyShortStopObservation(), startPressed: true, settled: true, rowsBefore: SAVED, rowsAfter: [...SAVED, { id: 'probe', status: 'failed' }],
    acceptedCompletingSaves: 0, acceptedFailedMarks: 1, acceptedUnreadableSaves: 0, pendingSaves: 0, stopPressedWhileRecording: true,
    startToStopMs: 1_800, savedConfirmationShown: false, notSavedShown: true, unsettledDiscardShown: false, coachingRequests: 0, liveTracksAfterStop: 0, ...o,
});
const judge = (o: ShortStopObservation) => { const r = sink(); shortStopRow(r, o); expect(r.rows).toHaveLength(1); return r.rows[0]; };

describe('J1.c is the plan\'s own new row on its own leg', () => {
    it('the row name is the design\'s J1.c assertion, and J1.c is a leg of AHT-01', () => {
        expect(plan.NEW_ROWS.filter((r) => r.leg === J1C_LEG).map((r) => r.assertion)).toEqual([J1C_ROW]);
        expect(plan.ALL_LEGS.find((l) => l.id === J1C_LEG)?.caseId).toBe('AHT-01');
        expect(judge(good()).step).toBe(J1C_ROW);
    });
});

describe('shortStopRow: the real oracle on what the step observed', () => {
    it('PASS: a settled discard (one new row marked failed, "too short" shown) and a discard that left no row', () => {
        expect(judge(good())).toMatchObject({ verdict: 'PASS', detail: 'nothing saved after a short Stop; its row settled as failed' });
        expect(judge(good({ rowsAfter: SAVED, acceptedFailedMarks: 0 })).verdict).toBe('PASS');
    });
    it('FAIL: the take completed, an earlier take changed, a completing save was accepted, the page said saved, or said nothing', () => {
        expect(judge(good({ rowsAfter: [...SAVED, { id: 'probe', status: 'completed' }] })).verdict).toBe('FAIL');
        expect(judge(good({ rowsAfter: [{ id: 's1', status: 'failed' }, ...SAVED.slice(1)] })).verdict).toBe('FAIL');
        expect(judge(good({ acceptedCompletingSaves: 1 })).verdict).toBe('FAIL');
        expect(judge(good({ savedConfirmationShown: true })).verdict).toBe('FAIL');
        expect(judge(good({ notSavedShown: false })).verdict).toBe('FAIL');
    });
    it('FAIL closed: an accepted save whose status could not be read counts as completing the take', () => {
        expect(shortStopInput(good({ acceptedUnreadableSaves: 1 })).acceptedCompletingSaves).toBe(1);
        expect(judge(good({ acceptedUnreadableSaves: 1 })).verdict).toBe('FAIL');
        expect(shortStopInput(good({ acceptedUnreadableSaves: null })).acceptedCompletingSaves).toBeNull();
    });
    it('HOLD: not exercised, not settled, the discard not cleared, or anything unobserved (never a guess)', () => {
        expect(judge(good({ stopPressedWhileRecording: false })).verdict).toBe('HOLD');
        expect(judge(good({ settled: false })).verdict).toBe('HOLD');
        expect(judge(good({ notSavedShown: false, unsettledDiscardShown: true, rowsAfter: [...SAVED, { id: 'probe', status: 'active' }] })).verdict).toBe('HOLD');
        for (const k of ['rowsBefore', 'rowsAfter', 'acceptedCompletingSaves', 'acceptedFailedMarks', 'acceptedUnreadableSaves', 'stopPressedWhileRecording',
            'savedConfirmationShown', 'notSavedShown', 'unsettledDiscardShown'] as const) {
            expect({ k, v: judge(good({ [k]: null })).verdict }).toEqual({ k, v: 'HOLD' });
        }
        expect(judge(emptyShortStopObservation()).verdict).toBe('HOLD');
    });
    it('carries the step\'s closed reason, and counts and booleans only: no session id reaches the row', () => {
        const row = judge(good({ settled: false, reason: 'the short-Stop take could not be stopped' }));
        expect(row.detail).toBe('the page did not settle after Stop; the short-Stop take could not be stopped');
        const all = judge(good());
        expect(all.evidence).toMatchObject({ leg: J1C_LEG, rowsBefore: 4, rowsAfter: 5, acceptedFailedMarks: 1, startToStopMs: 1_800 });
        expect(Object.values(all.evidence ?? {}).every((v) => v === null || typeof v === 'number' || typeof v === 'boolean' || v === J1C_LEG)).toBe(true);
        expect(JSON.stringify(all)).not.toMatch(/"s1"|"probe"/);
    });
    it('a verdict outside PASS/FAIL/HOLD, or none, is a HOLD', () => {
        const r = sink();
        expect(shortStopRow(r, good(), () => ({ outcome: 'NOT RUN' as never, detail: 'x' }))).toBe('HOLD');
        expect(shortStopRow(r, good(), () => undefined as never)).toBe('HOLD');
        expect(r.rows[1].detail).toBe('the short-Stop oracle gave no verdict');
    });
});

describe('stopFacts / shownFacts / shortStopTakeOf', () => {
    const probe = (o: Partial<ShortStopProbeState> = {}): ShortStopProbeState => ({ startAt: 100, stopAt: 1_900, stopWhileRecording: true, saved: false,
        settledMessage: true, unsettledMessage: false, ...o });
    it('a Stop on the recording recorder inside the bound is a short Stop', () => {
        expect(stopFacts(probe())).toEqual({ startPressed: true, stopPressedWhileRecording: true, startToStopMs: 1_800 });
    });
    it('CASUALTY: a slow Stop, a Stop off the recorder, a missing click or an unreadable probe is never a short Stop', () => {
        expect(stopFacts(probe({ stopAt: 100 + SHORT_STOP_MAX_MS })).stopPressedWhileRecording).toBe(false);
        expect(stopFacts(probe({ stopAt: 100 + SHORT_STOP_MAX_MS - 1 })).stopPressedWhileRecording).toBe(true);
        expect(stopFacts(probe({ stopWhileRecording: false })).stopPressedWhileRecording).toBe(false);
        expect(stopFacts(probe({ stopWhileRecording: null })).stopPressedWhileRecording).toBe(false);
        expect(stopFacts(probe({ stopAt: 50 })).stopPressedWhileRecording).toBe(false);
        expect(stopFacts(probe({ stopAt: null }))).toEqual({ startPressed: true, stopPressedWhileRecording: false, startToStopMs: null });
        expect(stopFacts(probe({ startAt: null }))).toEqual({ startPressed: false, stopPressedWhileRecording: false, startToStopMs: null });
        expect(stopFacts(null)).toEqual({ startPressed: null, stopPressedWhileRecording: null, startToStopMs: null });
    });
    it('what the page said comes from the probe, and is unknown without one', () => {
        expect(shownFacts(probe({ saved: true, unsettledMessage: true }))).toEqual({ savedConfirmationShown: true, notSavedShown: true, unsettledDiscardShown: true });
        expect(shownFacts(null)).toEqual({ savedConfirmationShown: null, notSavedShown: null, unsettledDiscardShown: null });
    });
    it('the take is a no-save probe only when the short Stop was exercised', () => {
        expect(shortStopTakeOf(good())).toBe('probe');
        expect(shortStopTakeOf(good({ startPressed: false }))).toBe('not-started');
        expect(shortStopTakeOf(good({ stopPressedWhileRecording: false }))).toBe('unknown');
        expect(shortStopTakeOf(good({ stopPressedWhileRecording: null }))).toBe('unknown');
        expect(shortStopTakeOf(good({ startPressed: null }))).toBe('unknown');
        expect(shortStopTakeOf(null)).toBe('unknown');
    });
});

describe('the in-page probe (the product\'s DOM, simulated)', () => {
    /** `page.evaluate` runs the probe's own function in this document, as the browser would. */
    const page = { evaluate: async (fn: (a?: unknown) => unknown, arg?: unknown) => fn(arg) } as never;
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const render = (recording: boolean, stopDisabled = false) => {
        document.body.innerHTML = `<div data-testid="live-session-header" data-session-saved="false"><span data-testid="status-message-text">Ready</span></div>
            <button data-testid="mic-start">Start</button>${recording ? `<div data-testid="recorder-bar"><button data-testid="recorder-stop" ${stopDisabled ? 'disabled' : ''}>Stop</button></div>` : ''}`;
    };
    const say = (text: string) => { document.querySelector('[data-testid="status-message-text"]')!.textContent = text; };
    const click = (id: string) => (document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    it('times both clicks on the page clock, reads the recorder at the Stop click, and sees a "too short" shown after Stop', async () => {
        render(false);
        await armShortStopProbe(page);
        const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(2_500);
        click('mic-start');
        render(true);
        click('recorder-stop');
        clock.mockRestore();
        render(false);
        say('Session too short (1s). Minimum 5s required.');
        await tick();
        expect(await readShortStopProbe(page)).toEqual({ startAt: 1_000, stopAt: 2_500, stopWhileRecording: true, saved: false, settledMessage: true, unsettledMessage: false });
    });
    it('a message shown and then replaced is still seen; the unsettled warning is its own fact', async () => {
        render(false);
        await armShortStopProbe(page);
        click('mic-start');
        render(true);
        click('recorder-stop');
        render(false);
        say('Session too short (2s). It wasn\'t saved, but we couldn\'t finish clearing it.');
        await tick();
        say('Ready');
        await tick();
        const p = await readShortStopProbe(page);
        expect(p).toMatchObject({ settledMessage: false, unsettledMessage: true, saved: false });
    });
    it('CASUALTY: a saved confirmation after Stop is seen; a disabled Stop is not a Stop while recording', async () => {
        render(false);
        await armShortStopProbe(page);
        click('mic-start');
        render(true, true);
        click('recorder-stop');
        render(false);
        document.querySelector('[data-testid="live-session-header"]')!.setAttribute('data-session-saved', 'true');
        await tick();
        expect(await readShortStopProbe(page)).toMatchObject({ stopWhileRecording: false, saved: true });
    });
    it('nothing before the Stop click counts, and a runtime state other than recording is not recording', async () => {
        render(false);
        await armShortStopProbe(page);
        say('Session too short (1s). Minimum 5s required.');
        document.querySelector('[data-testid="live-session-header"]')!.setAttribute('data-session-saved', 'true');
        await tick();
        expect(await readShortStopProbe(page)).toMatchObject({ startAt: null, stopAt: null, saved: false, settledMessage: false });
        render(true);
        document.documentElement.setAttribute('data-recording-state', 'stopping');
        click('recorder-stop');
        document.documentElement.removeAttribute('data-recording-state');
        expect(await readShortStopProbe(page)).toMatchObject({ stopWhileRecording: false });
    });
    it('an unarmed or malformed probe reads as unknown', async () => {
        delete (window as unknown as { __rwtShortStop?: unknown }).__rwtShortStop;
        expect(await readShortStopProbe(page)).toBeNull();
        (window as unknown as { __rwtShortStop?: unknown }).__rwtShortStop = { startAt: 'x', stopAt: null, stopWhileRecording: null, saved: false, settledMessage: false, unsettledMessage: false };
        expect(await readShortStopProbe(page)).toBeNull();
        const failing = { evaluate: async () => { throw new Error('page closed'); } } as never;
        expect(await readShortStopProbe(failing)).toBeNull();
    });
    it('the messages match the product\'s own copy (useSessionLifecycle.ts) with the leading emoji removed', () => {
        expect(SETTLED_DISCARD_TEXT.test('Session too short (3s). Minimum 5s required.')).toBe(true);
        expect(UNSETTLED_DISCARD_TEXT.test('Session too short (3s). It wasn\'t saved, but we couldn\'t finish clearing it.')).toBe(true);
        expect(SETTLED_DISCARD_TEXT.test('Session too short (3s). It wasn\'t saved, but we couldn\'t finish clearing it.')).toBe(false);
        const source = readFileSync(resolve(__dirname, '../../frontend/src/hooks/useSessionLifecycle.ts'), 'utf8');
        expect(source).toContain('message: `⚠️ Session too short (${elapsedAtStop}s). Minimum ${MIN_SESSION_DURATION_SECONDS}s required.`');
        expect(source).toContain('message: `⚠️ Session too short (${elapsedAtStop}s). It wasn\'t saved, but we couldn\'t finish clearing it.`');
    });
});

describe('awaitShortStopSettled', () => {
    const state = (o: Partial<ShortStopProbeState> = {}): ShortStopProbeState => ({ startAt: 0, stopAt: 1, stopWhileRecording: true, saved: false,
        settledMessage: false, unsettledMessage: false, ...o });
    const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms; } }; };
    it('settles as soon as the recorder is gone, nothing is pending and the page has spoken', async () => {
        const c = clock();
        const reads = [state(), state(), state({ settledMessage: true })];
        const r = await awaitShortStopSettled({ ...c, readProbe: async () => reads.shift() ?? state({ settledMessage: true }), recorderGone: async () => true, pendingSaves: () => 0 });
        expect(r).toMatchObject({ settled: true, probe: { settledMessage: true } });
        expect(c.now()).toBe(500);
    });
    it('a pending save or a live recorder keeps it waiting; at the bound it is not settled', async () => {
        const c = clock();
        const r = await awaitShortStopSettled({ ...c, readProbe: async () => state({ settledMessage: true }), recorderGone: async () => true, pendingSaves: () => 1 });
        expect(r.settled).toBe(false);
        expect(c.now()).toBe(SHORT_STOP_SETTLE_MS);
        const live = await awaitShortStopSettled({ ...clock(), readProbe: async () => state({ settledMessage: true }), recorderGone: async () => false, pendingSaves: () => 0 });
        expect(live.settled).toBe(false);
        const broken = await awaitShortStopSettled({ ...clock(), readProbe: async () => state({ settledMessage: true }), recorderGone: async () => { throw new Error('x'); }, pendingSaves: () => 0 });
        expect(broken.settled).toBe(false);
    });
    it('a quiet page that never speaks settles at the bound (so the oracle can fail its silence); an unreadable probe never settles', async () => {
        const c = clock();
        const r = await awaitShortStopSettled({ ...c, readProbe: async () => state(), recorderGone: async () => true, pendingSaves: () => 0 });
        expect(r).toMatchObject({ settled: true, probe: { settledMessage: false, unsettledMessage: false, saved: false } });
        expect(c.now()).toBe(SHORT_STOP_SETTLE_MS);
        const blind = await awaitShortStopSettled({ ...clock(), readProbe: async () => null, recorderGone: async () => true, pendingSaves: () => 0 });
        expect(blind).toEqual({ probe: null, settled: false });
    });
});

describe('ShortStopSaveTap', () => {
    const fakeContext = () => {
        const handlers: Record<string, Array<(x: unknown) => void>> = {};
        return {
            on: (ev: string, h: (x: unknown) => void) => { (handlers[ev] ??= []).push(h); },
            off: (ev: string, h: (x: unknown) => void) => { handlers[ev] = (handlers[ev] ?? []).filter((x) => x !== h); },
            emit: (ev: string, x: unknown) => (handlers[ev] ?? []).forEach((h) => h(x)),
        };
    };
    const req = (url: string, body: unknown, status: number | null, method = 'POST') => ({
        method: () => method, url: () => url,
        postDataJSON: () => { if (body === 'unreadable') throw new Error('x'); return body; },
        response: async () => (status === null ? null : { status: () => status }),
    });
    const SAVE = 'https://x.supabase.co/rest/v1/rpc/complete_session_v2';
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    it('counts accepted saves by p_status, holds unanswered ones pending, and never accepts an error, a null answer or a failure', async () => {
        const f = fakeContext();
        const tap = new ShortStopSaveTap();
        tap.attach(f as never);
        const failedOk = req(SAVE, { p_status: 'failed' }, 200);
        const completedOk = req(SAVE, { p_status: 'completed' }, 204);
        const failed500 = req(SAVE, { p_status: 'failed' }, 500);
        const noAnswer = req(SAVE, { p_status: 'failed' }, null);
        const aborted = req(`${SAVE}?x=1`, { p_status: 'completed' }, 200);
        const open = req(SAVE, { p_status: 'failed' }, 200);
        const unreadable = req(SAVE, 'unreadable', 200);
        for (const r of [failedOk, completedOk, failed500, noAnswer, aborted, open, unreadable]) f.emit('request', r);
        expect(tap.pending).toBe(7);
        for (const r of [failedOk, completedOk, failed500, noAnswer, unreadable]) f.emit('requestfinished', r);
        f.emit('requestfailed', aborted);
        await flush();
        expect({ pending: tap.pending, completing: tap.acceptedCompletingSaves, failed: tap.acceptedFailedMarks, unreadable: tap.acceptedUnreadable })
            .toEqual({ pending: 1, completing: 1, failed: 1, unreadable: 1 });
    });
    it('counts coaching requests, ignores other requests and GETs, and stops counting once detached', async () => {
        const f = fakeContext();
        const tap = new ShortStopSaveTap();
        tap.attach(f as never);
        f.emit('request', req('https://x.supabase.co/functions/v1/get-ai-suggestions', {}, 200));
        f.emit('request', req(SAVE, { p_status: 'completed' }, 200, 'GET'));
        f.emit('request', req('https://x.supabase.co/rest/v1/rpc/acquire_recording_lease', {}, 200));
        expect({ coaching: tap.coachingRequests, pending: tap.pending }).toEqual({ coaching: 1, pending: 0 });
        tap.detach();
        tap.detach();
        f.emit('request', req(SAVE, { p_status: 'completed' }, 200));
        f.emit('request', req('https://x.supabase.co/functions/v1/get-ai-suggestions', {}, 200));
        expect({ coaching: tap.coachingRequests, pending: tap.pending }).toEqual({ coaching: 1, pending: 0 });
    });
});

describe('sessionRowsReader', () => {
    const admin = (answer: unknown, seen: unknown[] = []) => ({
        from: (t: string) => ({ select: (c: string) => ({ eq: (k: string, v: string) => { seen.push([t, c, k, v]); return typeof answer === 'function' ? (answer as () => unknown)() : Promise.resolve(answer); } }) }),
    });
    it('reads the account\'s own rows (id and status only), bound by its id', async () => {
        const seen: unknown[] = [];
        const rows = await sessionRowsReader(admin({ data: [{ id: 'a', status: 'completed', extra: 1 }, { id: 'b', status: null }], error: null }, seen) as never, 'owner')();
        expect(rows).toEqual([{ id: 'a', status: 'completed' }, { id: 'b', status: null }]);
        expect(seen).toEqual([['sessions', 'id,status', 'user_id', 'owner']]);
    });
    it('CASUALTY: an error, a malformed answer, a throw, a timeout, no client or no owner is unobserved (null), never an empty list', async () => {
        expect(await sessionRowsReader(admin({ data: null, error: { code: 'x' } }) as never, 'o')()).toBeNull();
        expect(await sessionRowsReader(admin({ data: [{ id: '', status: 'completed' }], error: null }) as never, 'o')()).toBeNull();
        expect(await sessionRowsReader(admin({ data: [{ id: 'a', status: 3 }], error: null }) as never, 'o')()).toBeNull();
        expect(await sessionRowsReader(admin(() => { throw new Error('x'); }) as never, 'o')()).toBeNull();
        expect(await sessionRowsReader(admin(() => new Promise(() => undefined)) as never, 'o', 5)()).toBeNull();
        expect(await sessionRowsReader(null, 'o')()).toBeNull();
        expect(await sessionRowsReader(admin({ data: [], error: null }) as never, '')()).toBeNull();
        expect(await sessionRowsReader(admin({ data: [], error: null }) as never, 'o')()).toEqual([]);
    });
});

describe('J1.c wiring (the Open Mic journey and the shared runner)', () => {
    const spec = readFileSync(resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
    const runner = readFileSync(resolve(__dirname, '../live/helpers/rwtJourney.ts'), 'utf8');
    it('runs as its own step after J1.a\'s last check and before J1.d, with its own HOLD on any failure', () => {
        const numeric = spec.indexOf("await test.step('saved and displayed comparison numbers match'");
        const j1c = spec.indexOf("await test.step('J1.c — a short Stop saves nothing'");
        const j1d = spec.indexOf("await test.step('J1.d — sign out, deep link, sign back in, history preserved'");
        expect([numeric > -1, j1c > numeric, j1d > j1c]).toEqual([true, true, true]);
        const step = spec.slice(j1c, j1d);
        expect(step).toContain("const obs = await shortStopEvidence(page, `${SUITE}-short-stop`, sessionRowsReader(admin as never, capturedUid),\n                        () => captureGate().confirm());");
        // #1835: a changed privacy choice is the run's stop, rethrown after J1.c records its own HOLD.
        const caught = step.slice(step.indexOf('} catch (error) {'));
        expect(caught.indexOf("receipt.row(J1C_ROW, 'HOLD'")).toBeGreaterThan(0);
        expect(caught.indexOf("if (error instanceof Error && error.message.startsWith('HOLD practice consent:')) throw error;"))
            .toBeGreaterThan(caught.indexOf("receipt.row(J1C_ROW, 'HOLD'"));
        expect(step).toContain('shortStopTake = shortStopTakeOf(obs);');
        expect(step).toContain('shortStopRow(receipt, obs);');
        expect(step).toContain("shortStopTake = 'unknown';");
        expect(step).toContain("receipt.row(J1C_ROW, 'HOLD', `the J1.c short Stop did not complete (${name})`, { leg: J1C_LEG });");
    });
    it('probe-save-isolation judges take 5 as J1.c\'s probe only when it was exercised', () => {
        const isolation = spec.slice(spec.indexOf("await steps.step('probe saves isolated'"), spec.indexOf("await steps.step('owned pages closed'"));
        expect(isolation).toContain("else if (shortStopTake === 'unknown') aliveReceipt(receipt, alive).row('probe saves isolated', 'HOLD'");
        expect(isolation).toContain('AHT01_DESIGNED_TAKES, AHT01_DESIGNED_SAVES);');
    });
    it('the runner arms the probe and reads the rows before its one Start, and waits for the page to settle before the rows after', () => {
        const fn = runner.slice(runner.indexOf('export async function shortStopEvidence('), runner.indexOf('async function boundedTeardown('));
        const order = ['await armShortStopProbe(page);', 'obs.rowsBefore = await readRows();', 'await startBenchmarkRecording(page, label, undefined, consent);',
            'await stopBenchmarkRecording(page, label, SHORT_STOP_SETTLE_MS);', 'await awaitShortStopSettled({', 'obs.rowsAfter = await readRows();'].map((x) => fn.indexOf(x));
        expect(order.every((i) => i > -1)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(fn.match(/startBenchmarkRecording\(/g)).toHaveLength(1);
        expect(fn).toContain('tap.detach();');
        expect(fn).not.toMatch(/mic-retry|ai-suggestions-retry|\.click\(/);
    });
});
