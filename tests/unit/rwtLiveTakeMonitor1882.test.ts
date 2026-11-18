// @vitest-environment jsdom
/**
 * #1882 live timing evidence (Sam's Nov 18 reset, row 3.1): the Focus take's live time is MEASURED on the page, continuously,
 * for the same take, through the actual Stop press, and its terminal result and saved row are bound to that take.
 *
 * The REAL in-page monitor (`installTakeMonitor`) runs here in jsdom against a model app that behaves like SpeakSharp where it
 * matters: the shell shows `data-session-state="during"` only while capture is live; `__SPEECH_RUNTIME_DEBUG__` names the take
 * by `lifecycleVersion`; the app's own live clock starts at capture live; Stop under MIN_SESSION_DURATION_SECONDS shows
 * "Session too short" and saves nothing; a longer take sets `data-session-persisted(-id)` after a save delay.
 *
 * Controls (each must trip its intended assertion, never a setup error):
 *   delayed capture · capture drop then resume · take replaced mid-hold · take replaced between the last check and Stop ·
 *   capture never live · too-short with no save candidate · monitor tick gap · stale saved marker · session id mismatch.
 * The MECHANISM tests show what main's sleep-only helper claimed in the same situations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { MIN_SESSION_DURATION_SECONDS } from '@/config/env';
import {
    armTakeMonitor, awaitTakeOutcome, disposeTakeMonitor, holdMeasuredLiveTake, liveTakeVerdict, readTakeMonitor, savedTakeBinding,
    takeOutcomeOf, firstLiveEdge, firstBreakAfter, installTakeMonitor, readTakeMonitorInPage, disposeTakeMonitorInPage, takeEvidenceRows,
    stopGuardVerdict, stopMeasuredTake, guardedStopInPage, guardedStopClick, stopMonitoredTake,
    type MonitorSnapshot,
} from '../live/helpers/rwtLiveTakeMonitor';

/** The journey's switch-take length for focus_points_tts: max(8, min(9, 11.98 - 2)) = 9. */
const LIVE_SECONDS = 9;

type Debug = { lifecycleVersion: number; sessionId: string | null };

/** A model of the app's take lifecycle on a real (jsdom) DOM. */
class ModelApp {
    readonly shell = document.createElement('div');
    readonly stopButton = document.createElement('button');
    readonly status = document.createElement('div');
    debug: Debug = { lifecycleVersion: 1, sessionId: null };
    appStartTime: number | null = null;
    stopped = false;
    savedId: string | null = null;
    tooShort = false;

    constructor(private readonly opts: { saveDelayMs?: number; sessionIdAtStart?: string | null; savedIdOverride?: string } = {}) {
        document.body.innerHTML = '';
        document.documentElement.removeAttribute('data-session-persisted');
        document.documentElement.removeAttribute('data-session-persisted-id');
        this.shell.setAttribute('data-testid', 'session-shell');
        this.shell.setAttribute('data-session-state', 'before');
        this.stopButton.setAttribute('data-testid', 'recorder-stop');
        this.status.setAttribute('data-testid', 'session-status-indicator');
        document.body.append(this.shell, this.stopButton, this.status);
        (window as unknown as { __SPEECH_RUNTIME_DEBUG__?: () => Debug }).__SPEECH_RUNTIME_DEBUG__ = () => ({ ...this.debug });
        (window as unknown as { useSessionStore?: unknown }).useSessionStore = { getState: () => ({ startTime: this.appStartTime }) };
        this.stopButton.addEventListener('click', () => this.stop());
    }

    /** The marker of the PREVIOUS take, still on the page when this one starts (cleared on the next recording). */
    leaveStaleMarker(id: string): void {
        document.documentElement.setAttribute('data-session-persisted', 'true');
        document.documentElement.setAttribute('data-session-persisted-id', id);
    }

    /** Start press: the app clears the previous saved marker, then capture goes live after `pressToLiveMs` (null: never). */
    press(pressToLiveMs: number | null, opts: { clearMarker?: boolean } = {}): void {
        if (opts.clearMarker !== false) {
            document.documentElement.removeAttribute('data-session-persisted');
            document.documentElement.removeAttribute('data-session-persisted-id');
        }
        // Like SpeechRuntimeController, the session row (and its id) is created at the start of the take.
        const next = this.debug.lifecycleVersion + 1;
        this.debug = { lifecycleVersion: next, sessionId: this.opts.sessionIdAtStart === undefined ? `row-${next}` : this.opts.sessionIdAtStart };
        if (pressToLiveMs !== null) setTimeout(() => this.goLive(), pressToLiveMs);
    }

    goLive(): void {
        this.appStartTime = Date.now();
        this.shell.setAttribute('data-session-state', 'during');
    }

    /** Capture stops being live for `forMs` (the shell leaves `during`), then resumes on the same take. */
    dropCapture(atMs: number, forMs: number): void {
        setTimeout(() => this.shell.setAttribute('data-session-state', 'before'), atMs);
        setTimeout(() => this.shell.setAttribute('data-session-state', 'during'), atMs + forMs);
    }

    /** Another take replaces this one while the shell keeps showing a live take (nothing re-renders the attribute). */
    replaceTake(atMs: number): void {
        setTimeout(() => { this.debug = { lifecycleVersion: this.debug.lifecycleVersion + 7, sessionId: null }; }, atMs);
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        const elapsed = this.appStartTime === null ? 0 : Math.floor((Date.now() - this.appStartTime) / 1000);
        this.shell.setAttribute('data-session-state', 'after');
        this.debug = { ...this.debug, lifecycleVersion: this.debug.lifecycleVersion + 1 }; // the Stop advances the lifecycle
        if (elapsed < MIN_SESSION_DURATION_SECONDS) {
            this.tooShort = true;
            this.status.textContent = `⚠️ Session too short (${elapsed}s). Minimum ${MIN_SESSION_DURATION_SECONDS}s required.`;
            return;
        }
        setTimeout(() => {
            this.savedId = this.opts.savedIdOverride ?? this.debug.sessionId ?? `row-${this.debug.lifecycleVersion}`;
            document.documentElement.setAttribute('data-session-persisted', 'true');
            document.documentElement.setAttribute('data-session-persisted-id', this.savedId);
        }, this.opts.saveDelayMs ?? 1_500);
    }
}

/** Playwright's Page as the helpers use it, running the in-page functions in this jsdom window. */
const pageOf = (): Page => ({
    evaluate: async <A, R>(fn: (arg: A) => R, arg: A) => fn(arg),
    waitForTimeout: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
} as unknown as Page);

const run = async <T>(work: Promise<T>, ms = 120_000): Promise<T> => {
    const done = work.then((v) => v);
    await vi.advanceTimersByTimeAsync(ms);
    return done;
};

/** The take as the fixed journey runs it: arm, read the press time, press, hold MEASURED, Stop, wait for the outcome. */
async function measuredTake(app: ModelApp, pressToLiveMs: number | null, extra: (app: ModelApp) => void = () => undefined,
    beforeStop: (app: ModelApp) => void = () => undefined) {
    const page = pageOf();
    const armed = await armTakeMonitor(page, 'switch-focus');
    const pressedAt = Date.now();
    app.press(pressToLiveMs);
    extra(app);
    const hold = await holdMeasuredLiveTake(page, armed, LIVE_SECONDS, { nodePressedAt: pressedAt });
    beforeStop(app);
    app.stopButton.click();
    const outcome = await awaitTakeOutcome(page, armed.token, 10_000);
    const snap = await readTakeMonitor(page, armed.token);
    await disposeTakeMonitor(page, armed.token);
    return { hold, outcome, snap, verdict: liveTakeVerdict(snap, { liveSeconds: LIVE_SECONDS, pressedAt }), binding: savedTakeBinding(snap) };
}

/** main's helper (rwtLiveTimedTake.ts on 1ed8427d), verbatim in behaviour: wait for live once, sleep, CLAIM the hold. */
async function mainHoldLiveTake(page: Page, liveSeconds: number, pressedAtMs: number) {
    const shell = () => document.querySelector('[data-testid="session-shell"]')?.getAttribute('data-session-state') === 'during';
    const deadline = Date.now() + 60_000;
    while (!shell()) {
        if (Date.now() >= deadline) return { pressToLiveMs: null, heldLiveSeconds: 0 };
        await page.waitForTimeout(50);
    }
    const pressToLiveMs = Math.max(0, Date.now() - pressedAtMs);
    await page.waitForTimeout(Math.round(liveSeconds * 1000));
    return { pressToLiveMs, heldLiveSeconds: liveSeconds };
}

const log = (name: string, value: unknown) => console.log(`#1882_LIVE_TIMING ${JSON.stringify({ control: name, ...(value as object) })}`);

describe('#1882 — the Focus take is measured live, continuously, through the actual Stop', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-18T12:00:00Z')); });
    afterEach(() => { vi.useRealTimers(); });

    it.each([0, 1_500, 4_500, 9_800])('DELAYED CAPTURE: live %i ms after the press still gets nine measured live seconds, saved and bound', async (delay) => {
        const app = new ModelApp();
        const r = await run(measuredTake(app, delay));
        log('delayed_capture', { delay, hold: r.hold, verdict: r.verdict, outcome: r.outcome, binding: r.binding });
        expect(r.hold.ended).toBe('held');
        expect(r.hold.pressToLiveMs).toBeGreaterThanOrEqual(delay);
        expect(r.hold.pressToLiveMs).toBeLessThanOrEqual(delay + 100);
        expect(r.verdict).toMatchObject({ verdict: 'PASS', reason: 'live_through_stop' });
        expect(r.verdict.liveSecondsAtStop).toBeGreaterThanOrEqual(LIVE_SECONDS);
        expect(r.verdict.liveSecondsAtStop).toBeLessThan(LIVE_SECONDS + 0.5);
        expect(r.verdict.appElapsedSecondsAtStop).toBeGreaterThanOrEqual(LIVE_SECONDS);
        expect(r.verdict.pressToLiveMs).toBe(delay);
        expect(app.tooShort).toBe(false);
        expect(r.outcome).toMatchObject({ kind: 'saved', id: app.savedId });
        expect(r.binding).toMatchObject({ verdict: 'PASS', reason: 'bound', persistedId: app.savedId });
    });

    it('DROPPED CAPTURE: a drop at 3 s that resumes at 4 s is a FAIL at the break, and the hold ends there', async () => {
        const app = new ModelApp();
        const r = await run(measuredTake(app, 1_000, (a) => a.dropCapture(1_000 + 3_000, 1_000)));
        log('capture_dropped', { hold: r.hold, verdict: r.verdict });
        expect(r.hold.ended).toBe('capture_dropped');
        expect(r.hold.measuredLiveMs).toBe(3_000);
        expect(r.verdict.verdict).toBe('FAIL');
        expect(r.verdict.reason).toBe('capture_dropped');
        expect(r.verdict.breakAtSeconds).toBe(3);
    });

    it('MECHANISM: main\'s helper claims nine held live seconds through the same drop', async () => {
        const app = new ModelApp();
        const page = pageOf();
        const pressedAt = Date.now();
        app.press(1_000);
        app.dropCapture(4_000, 1_000);
        const claim = await run(mainHoldLiveTake(page, LIVE_SECONDS, pressedAt));
        log('main_claim_drop', { claim });
        expect(claim.heldLiveSeconds).toBe(LIVE_SECONDS); // the claim; the take was live for 3 s, then dropped
    });

    it('REPLACED TAKE: a different take while the shell still reads live is a FAIL, not continuity', async () => {
        const app = new ModelApp();
        const r = await run(measuredTake(app, 500, (a) => a.replaceTake(500 + 5_000)));
        log('take_replaced', { hold: r.hold, verdict: r.verdict });
        expect(r.hold.ended).toBe('take_replaced');
        expect(r.verdict).toMatchObject({ verdict: 'FAIL', reason: 'take_replaced' });
        expect(r.verdict.breakAtSeconds).toBeGreaterThanOrEqual(5);
        expect(r.verdict.breakAtSeconds).toBeLessThanOrEqual(5.1);
    });

    it('SWAPPED AT STOP: a take replaced after the last hold check and before the Stop press is caught by the press itself', async () => {
        const app = new ModelApp();
        // The swap happens synchronously right before the click dispatch, so no monitor tick or poll can see it first.
        const r = await run(measuredTake(app, 500, () => undefined, (a) => { a.debug = { lifecycleVersion: a.debug.lifecycleVersion + 7, sessionId: null }; }));
        log('swapped_at_stop', { hold: r.hold, verdict: r.verdict });
        expect(r.hold.ended).toBe('held');
        expect(r.verdict.verdict).toBe('FAIL');
        // Recorded inside the press's own dispatch: the edge the click listener reads first, and the press's own reading.
        expect(['take_replaced', 'take_replaced_before_stop']).toContain(r.verdict.reason);
        expect(r.snap!.stops[0].key).not.toBe(r.verdict.takeKey);
    });

    it('SWAPPED AT STOP (press reading alone): a Stop press that reads another take FAILs even with no edge before it', () => {
        const snap: MonitorSnapshot = {
            token: 't', armedAt: 0, seq: 99, disposed: false, lastTick: 11_000, persisted: [], tooShort: null, tickGaps: [],
            edges: [{ seq: 1, t: 1_000, state: 'during', key: 'take:2', sessionId: null }],
            stops: [{ seq: 2, t: 10_500, state: 'during', key: 'take:9', sessionId: null, appStartTime: 1_000 }],
        };
        expect(liveTakeVerdict(snap, { liveSeconds: LIVE_SECONDS })).toMatchObject({ verdict: 'FAIL', reason: 'take_replaced_before_stop' });
        const ended = { ...snap, stops: [{ ...snap.stops[0], key: 'take:2', state: 'after' }] };
        expect(liveTakeVerdict(ended, { liveSeconds: LIVE_SECONDS })).toMatchObject({ verdict: 'FAIL', reason: 'capture_not_live_at_stop' });
    });

    it('NOT LIVE AT STOP: capture that ends right before the Stop press is a FAIL', async () => {
        const app = new ModelApp();
        const r = await run(measuredTake(app, 500, () => undefined, (a) => a.shell.setAttribute('data-session-state', 'before')));
        expect(r.verdict.verdict).toBe('FAIL');
        // The MutationObserver records the edge before the click, or the press itself reads it: either way never PASS.
        expect(['capture_dropped', 'capture_not_live_at_stop']).toContain(r.verdict.reason);
    });

    it('NEVER LIVE: no live edge in budget returns at once with no live time and a FAIL', async () => {
        const app = new ModelApp();
        const r = await run(measuredTake(app, null), 200_000);
        log('capture_never_live', { hold: r.hold, verdict: r.verdict, outcome: r.outcome });
        expect(r.hold).toEqual({ pressToLiveMs: null, measuredLiveMs: 0, ended: 'capture_never_live', takeKey: null });
        expect(r.verdict).toMatchObject({ verdict: 'FAIL', reason: 'capture_never_live', liveSecondsAtStop: 0 });
        expect(r.outcome.kind).toBe('too_short');
    });

    it('TOO SHORT: a take stopped after 3 live seconds is observed as too short at once, with no save candidate', async () => {
        const app = new ModelApp();
        const page = pageOf();
        const armed = await armTakeMonitor(page, 'too-short');
        const pressedAt = Date.now();
        app.press(500);
        const outcome = await run((async () => {
            await page.waitForTimeout(3_500);
            app.stopButton.click();
            const started = Date.now();
            const o = await awaitTakeOutcome(page, armed.token, 180_000);
            return { o, waitedMs: Date.now() - started };
        })());
        const snap = await readTakeMonitor(page, armed.token);
        const v = liveTakeVerdict(snap, { liveSeconds: LIVE_SECONDS, pressedAt });
        log('too_short', { outcome, verdict: v });
        expect(app.tooShort).toBe(true);
        expect(outcome.o.kind).toBe('too_short');
        expect(outcome.waitedMs).toBeLessThanOrEqual(250); // observed at once, not after a 180 s save-candidate wait
        expect(v).toMatchObject({ verdict: 'FAIL', reason: 'too_short' });
        expect(savedTakeBinding(snap)).toMatchObject({ verdict: 'FAIL', reason: 'too_short' });
    });

    it('MECHANISM: main\'s click-timed take (no live wait) with capture live 4.5 s after the press is too short', async () => {
        const app = new ModelApp();
        const page = pageOf();
        app.press(4_500);
        await run((async () => { await page.waitForTimeout(LIVE_SECONDS * 1000); app.stopButton.click(); })());
        expect(app.tooShort).toBe(true);
    });

    it('MONITOR GAP: a page that was not observed for over a second is HOLD, never PASS', () => {
        const snap: MonitorSnapshot = {
            token: 't', armedAt: 0, seq: 99, disposed: false, lastTick: 20_000, persisted: [], tooShort: null,
            edges: [{ seq: 1, t: 1_000, state: 'during', key: 'take:2', sessionId: null }],
            stops: [{ seq: 2, t: 10_500, state: 'during', key: 'take:2', sessionId: null, appStartTime: 1_000 }],
            tickGaps: [{ from: 4_000, to: 6_000 }],
        };
        expect(liveTakeVerdict(snap, { liveSeconds: LIVE_SECONDS })).toMatchObject({ verdict: 'HOLD', reason: 'monitor_gap' });
        expect(liveTakeVerdict({ ...snap, tickGaps: [{ from: 11_000, to: 13_000 }] }, { liveSeconds: LIVE_SECONDS }).verdict).toBe('PASS');
        expect(liveTakeVerdict(null, { liveSeconds: LIVE_SECONDS })).toMatchObject({ verdict: 'HOLD', reason: 'monitor_unreadable' });
    });

    it('HOLD SHORT: a Stop pressed before nine measured live seconds is a FAIL even if the app saved it', () => {
        const snap: MonitorSnapshot = {
            token: 't', armedAt: 0, seq: 99, disposed: false, lastTick: 9_000, persisted: [], tooShort: null, tickGaps: [],
            edges: [{ seq: 1, t: 1_000, state: 'during', key: 'take:2', sessionId: null }],
            stops: [{ seq: 2, t: 7_000, state: 'during', key: 'take:2', sessionId: null, appStartTime: 1_000 }],
        };
        expect(liveTakeVerdict(snap, { liveSeconds: LIVE_SECONDS })).toMatchObject({ verdict: 'FAIL', reason: 'hold_short', liveSecondsAtStop: 6 });
        expect(liveTakeVerdict({ ...snap, stops: [] }, { liveSeconds: LIVE_SECONDS })).toMatchObject({ verdict: 'FAIL', reason: 'no_stop_press' });
    });

    it('STALE MARKER: the previous take\'s saved marker never binds this take', async () => {
        const app = new ModelApp();
        app.leaveStaleMarker('row-previous');
        const page = pageOf();
        const armed = await armTakeMonitor(page, 'stale');
        app.press(500, { clearMarker: false });
        const r = await run((async () => {
            await holdMeasuredLiveTake(page, armed, LIVE_SECONDS);
            // Stop, but the app never writes a new marker (the save hangs): only the old one is on the page.
            app.stopped = true;
            app.stopButton.click();
            return awaitTakeOutcome(page, armed.token, 5_000);
        })());
        const snap = await readTakeMonitor(page, armed.token);
        log('stale_marker', { outcome: r, binding: savedTakeBinding(snap) });
        expect(r.kind).toBe('unsettled');
        expect(savedTakeBinding(snap)).toMatchObject({ verdict: 'FAIL', reason: 'stale_marker', persistedId: null });
    });

    it('SESSION ID: a saved id other than the session the controller named at Stop is a FAIL', async () => {
        const app = new ModelApp({ sessionIdAtStart: 'row-named', savedIdOverride: 'row-other' });
        const r = await run(measuredTake(app, 500));
        expect(r.verdict.verdict).toBe('PASS');
        expect(r.binding).toMatchObject({ verdict: 'FAIL', reason: 'session_id_mismatch', persistedId: 'row-other' });
        const same = new ModelApp({ sessionIdAtStart: 'row-named', savedIdOverride: 'row-named' });
        expect((await run(measuredTake(same, 500))).binding).toMatchObject({ verdict: 'PASS', persistedId: 'row-named' });
    });

    it('#1897 review 2 — GUARDED STOP: a hold that reports a drop or a replacement never presses Stop on the take now live', async () => {
        const cases: Array<[string, (a: ModelApp) => void, (a: ModelApp) => void, string]> = [
            ['take_replaced', (a) => a.replaceTake(500 + 5_000), () => undefined, 'take_replaced'],
            ['capture_dropped', (a) => a.dropCapture(500 + 3_000, 1_000), () => undefined, 'capture_dropped'],
            // Held in full, then replaced after the hold's last read and before the guard's fresh read.
            ['replaced_after_hold', () => undefined, (a) => { a.debug = { lifecycleVersion: a.debug.lifecycleVersion + 7, sessionId: 'row-replacement' }; }, 'take_replaced'],
        ];
        for (const [name, during, afterHold, reason] of cases) {
            const app = new ModelApp();
            const page = pageOf();
            const armed = await armTakeMonitor(page, name);
            const pressedAt = Date.now();
            app.press(500);
            during(app);
            let pressed = 0;
            const r = await run((async () => {
                const hold = await holdMeasuredLiveTake(page, armed, LIVE_SECONDS, { nodePressedAt: pressedAt });
                afterHold(app);
                await vi.advanceTimersByTimeAsync(200); // one monitor tick sees the swap
                // afterClick only confirms: the click itself is the page's own atomic check-and-click.
                const stop = await stopMeasuredTake(page, armed, hold, async () => { pressed += 1; });
                return { hold, stop };
            })());
            const snap = await readTakeMonitor(page, armed.token);
            log('guarded_stop', { name, hold: r.hold.ended, stop: r.stop, stops: snap?.stops.length });
            expect(r.hold.ended).toBe(name === 'replaced_after_hold' ? 'held' : reason);
            expect(r.stop).toEqual({ pressed: false, reason });
            expect(pressed).toBe(0);
            expect(app.stopped).toBe(false);
            expect(snap?.stops.length).toBe(0);
            expect(savedTakeBinding(snap)).toMatchObject({ verdict: 'FAIL', reason: 'no_stop_press' });
            expect(liveTakeVerdict(snap, { liveSeconds: LIVE_SECONDS, pressedAt }).verdict).toBe('FAIL');
        }
        // The same take, held in full and still live: the Stop step runs exactly once.
        const app = new ModelApp();
        const page = pageOf();
        const armed = await armTakeMonitor(page, 'held');
        app.press(500);
        let pressed = 0;
        let stoppedWhenConfirmed: boolean | null = null;
        const stop = await run((async () => {
            const hold = await holdMeasuredLiveTake(page, armed, LIVE_SECONDS);
            return stopMeasuredTake(page, armed, hold, async () => { pressed += 1; stoppedWhenConfirmed = app.stopped; });
        })());
        expect(stop).toEqual({ pressed: true, reason: 'held_and_live' });
        expect(pressed).toBe(1);
        expect(stoppedWhenConfirmed).toBe(true); // confirmed only AFTER the page clicked Stop
        expect(app.stopped).toBe(true);
        expect((await readTakeMonitor(page, armed.token))?.stops.map((x) => x.key)).toEqual(['take:2']);
    });

    it('#1897 review 2 — the stop guard, pure', () => {
        const snap: MonitorSnapshot = {
            token: 't', armedAt: 0, seq: 9, disposed: false, lastTick: 11_000, persisted: [], tooShort: null, tickGaps: [], stops: [],
            edges: [{ seq: 1, t: 1_000, state: 'during', key: 'take:2', sessionId: 'row-2' }],
        };
        const held = { pressToLiveMs: 0, measuredLiveMs: 9_000, ended: 'held' as const, takeKey: 'take:2' };
        expect(stopGuardVerdict(held, snap)).toEqual({ pressed: true, reason: 'held_and_live' });
        expect(stopGuardVerdict({ ...held, ended: 'capture_never_live', takeKey: null }, snap)).toEqual({ pressed: false, reason: 'capture_never_live' });
        expect(stopGuardVerdict({ ...held, ended: 'monitor_unreadable' }, snap)).toEqual({ pressed: false, reason: 'monitor_unreadable' });
        expect(stopGuardVerdict(held, null)).toEqual({ pressed: false, reason: 'monitor_unreadable' });
        expect(stopGuardVerdict({ ...held, takeKey: 'take:1' }, snap)).toEqual({ pressed: false, reason: 'take_replaced' });
        expect(stopGuardVerdict({ ...held, takeKey: null }, snap)).toEqual({ pressed: false, reason: 'take_replaced' });
        const swapped = { ...snap, edges: [...snap.edges, { seq: 2, t: 10_000, state: 'during', key: 'take:9', sessionId: null }] };
        expect(stopGuardVerdict(held, swapped)).toEqual({ pressed: false, reason: 'take_replaced' });
        const dropped = { ...snap, edges: [...snap.edges, { seq: 2, t: 10_000, state: 'before', key: 'take:2', sessionId: 'row-2' }] };
        expect(stopGuardVerdict(held, dropped)).toEqual({ pressed: false, reason: 'capture_dropped' });
    });

    it('#1897 review 3 — MISSING SESSION ID: a Stop that names no session (or an empty one) can never bind the saved row', async () => {
        for (const id of [null, '', '   ']) {
            const app = new ModelApp({ sessionIdAtStart: id, savedIdOverride: 'row-saved' });
            const r = await run(measuredTake(app, 500));
            log('session_id_missing', { id, binding: r.binding });
            expect(r.verdict.verdict).toBe('PASS');
            expect(r.outcome).toMatchObject({ kind: 'saved', id: 'row-saved' });
            expect(r.binding).toMatchObject({ verdict: 'FAIL', reason: 'session_id_missing', persistedId: 'row-saved' });
        }
    });

    it('#1897 review 3 — STOP COUNT: two Stop presses on one take FAIL both the timing and the binding', async () => {
        const app = new ModelApp();
        const page = pageOf();
        const armed = await armTakeMonitor(page, 'two-stops');
        const pressedAt = Date.now();
        app.press(500);
        const outcome = await run((async () => {
            await holdMeasuredLiveTake(page, armed, LIVE_SECONDS, { nodePressedAt: pressedAt });
            app.stopButton.click();
            app.stopButton.click();
            return awaitTakeOutcome(page, armed.token, 10_000);
        })());
        const snap = await readTakeMonitor(page, armed.token);
        log('stop_count', { stops: snap?.stops.length, outcome });
        expect(snap?.stops.length).toBe(2);
        expect(outcome.kind).toBe('saved');
        expect(liveTakeVerdict(snap, { liveSeconds: LIVE_SECONDS, pressedAt })).toMatchObject({ verdict: 'FAIL', reason: 'stop_count' });
        expect(savedTakeBinding(snap)).toMatchObject({ verdict: 'FAIL', reason: 'stop_count', persistedId: null });
    });

    it('ANOTHER TAKE BEFORE SAVE: a second live take between this Stop and the saved marker unbinds the row', () => {
        const snap: MonitorSnapshot = {
            token: 't', armedAt: 0, seq: 99, disposed: false, lastTick: 20_000, tooShort: null, tickGaps: [],
            edges: [{ seq: 1, t: 1_000, state: 'during', key: 'take:2', sessionId: null }, { seq: 3, t: 10_100, state: 'after', key: 'take:3', sessionId: null },
                { seq: 4, t: 11_000, state: 'during', key: 'take:5', sessionId: null }],
            stops: [{ seq: 2, t: 10_000, state: 'during', key: 'take:2', sessionId: null, appStartTime: 1_000 }],
            persisted: [{ seq: 0, t: 0, persisted: null, id: null }, { seq: 6, t: 12_000, persisted: 'true', id: 'row-x' }],
        };
        expect(savedTakeBinding(snap)).toMatchObject({ verdict: 'FAIL', reason: 'another_take_before_save' });
        expect(savedTakeBinding({ ...snap, stops: [] })).toMatchObject({ verdict: 'FAIL', reason: 'no_stop_press' });
        expect(savedTakeBinding(null)).toMatchObject({ verdict: 'FAIL', reason: 'no_stop_press' });
    });

    it('pure readers: the first live edge, the first break and the outcome order', () => {
        const snap: MonitorSnapshot = {
            token: 't', armedAt: 0, seq: 99, disposed: false, lastTick: 0, tickGaps: [],
            edges: [{ seq: 1, t: 0, state: 'before', key: 'take:1', sessionId: null }, { seq: 2, t: 100, state: 'during', key: null, sessionId: null },
                { seq: 3, t: 200, state: 'during', key: 'take:2', sessionId: null }, { seq: 6, t: 900, state: 'after', key: 'take:3', sessionId: null }],
            stops: [{ seq: 5, t: 800, state: 'during', key: 'take:2', sessionId: null, appStartTime: null }],
            persisted: [{ seq: 0, t: 0, persisted: null, id: null }, { seq: 7, t: 1_000, persisted: 'true', id: 'row-a' }],
            tooShort: { seq: 8, t: 1_200, key: 'take:3' },
        };
        const live = firstLiveEdge(snap)!;
        expect(live.t).toBe(200); // an unnamed take is not a live take
        expect(firstBreakAfter(snap, live, snap.stops[0].seq)).toBeNull();
        expect(firstBreakAfter(snap, live, Number.POSITIVE_INFINITY)?.t).toBe(900);
        expect(takeOutcomeOf(snap)).toMatchObject({ kind: 'saved', id: 'row-a', t: 1_000 });
        expect(takeOutcomeOf({ ...snap, tooShort: { seq: 5.5, t: 850, key: 'take:3' } })).toMatchObject({ kind: 'too_short', t: 850 });
        expect(takeOutcomeOf({ ...snap, stops: [] })).toEqual({ kind: 'unsettled' });
    });

    it('in-page functions: a re-arm replaces the monitor; a foreign token reads nothing; dispose stops recording', async () => {
        const app = new ModelApp();
        const cfg = { token: 'a', shellSelector: '[data-testid="session-shell"]', stopTestId: 'recorder-stop',
            statusTestId: 'session-status-indicator', tooShortText: 'Session too short', tickMs: 100, maxTickGapMs: 1_000 };
        expect(installTakeMonitor(cfg)).toEqual({ ok: true });
        expect(installTakeMonitor({ ...cfg, token: 'b' })).toEqual({ ok: true });
        expect(readTakeMonitorInPage('a')).toBeNull();
        expect(readTakeMonitorInPage('b')?.token).toBe('b');
        expect(disposeTakeMonitorInPage('a')).toBe(false);
        expect(disposeTakeMonitorInPage('b')).toBe(true);
        app.goLive();
        await vi.advanceTimersByTimeAsync(500);
        expect(readTakeMonitorInPage('b')?.edges.some((e) => e.state === 'during')).toBe(false);
        // An unreadable page arms nothing and holds nothing.
        const broken = { evaluate: async () => { throw new Error('detached'); }, waitForTimeout: async () => undefined } as unknown as Page;
        const armed = await armTakeMonitor(broken, 'broken');
        expect(armed.ok).toBe(false);
        expect(await holdMeasuredLiveTake(broken, armed, LIVE_SECONDS)).toMatchObject({ ended: 'monitor_unreadable' });
        expect(await readTakeMonitor(broken, armed.token)).toBeNull();
        await expect(holdMeasuredLiveTake(pageOf(), { ...armed, ok: true }, 0)).rejects.toThrow(/INVALID_SETUP/);
    });

    it('RECEIPT ROWS: a bound PASS take reads its row back; an unbound one never reads a row and fails its readback', async () => {
        const rows: Array<{ step: string; verdict: string; evidence?: Record<string, unknown> }> = [];
        const sink = { row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', _d: string, evidence?: Record<string, string | number | boolean | null>) => { rows.push({ step, verdict, evidence }); } };
        const app = new ModelApp();
        const r = await run(measuredTake(app, 800));
        const reads: string[] = [];
        const out = await takeEvidenceRows({ sink, name: 'Focus switch take', snap: r.snap, liveSeconds: LIVE_SECONDS, pressedAt: null, savedId: app.savedId,
            readRow: async (id) => { reads.push(id); return { id }; }, readback: (row, id, live) => ({ verdict: row && live >= LIVE_SECONDS && id === app.savedId ? 'PASS' : 'FAIL', reason: 'model' }) });
        expect(rows.map((x) => `${x.step}:${x.verdict}`)).toEqual(['Focus switch take live through Stop:PASS', 'Focus switch take saved row is this take:PASS', 'Focus switch take saved per consent:PASS']);
        expect(reads).toEqual([app.savedId]);
        expect(out.timing.reason).toBe('live_through_stop');
        rows.length = 0;
        reads.length = 0;
        // The journey read another session than this take's Stop produced: unbound, never read back.
        await takeEvidenceRows({ sink, name: 'x', snap: r.snap, liveSeconds: LIVE_SECONDS, pressedAt: null, savedId: 'row-other',
            readRow: async (id) => { reads.push(id); return { id }; }, readback: () => ({ verdict: 'PASS', reason: 'model' }) });
        expect(rows.map((x) => x.verdict)).toEqual(['PASS', 'FAIL', 'FAIL']);
        expect(rows[1].evidence?.reason).toBe('journey_read_other_row');
        expect(rows[2].evidence?.reason).toBe('row_not_bound');
        expect(reads).toEqual([]);
        rows.length = 0;
        await takeEvidenceRows({ sink, name: 'y', snap: null, liveSeconds: LIVE_SECONDS, pressedAt: null, savedId: null,
            readRow: async () => null, readback: () => ({ verdict: 'PASS', reason: 'model' }) });
        expect(rows.map((x) => x.verdict)).toEqual(['HOLD', 'FAIL', 'FAIL']);
    });
});

/**
 * #1897 f2bb1ae HOLD (Sam, Nov 18): the final take check and the Stop click must be ONE page task, for all four takes.
 * The forced race: a page whose next round trip after the last Node-side read swaps the live take for a replacement (the
 * shell still reads live), exactly the gap between f2bb1ae's snapshot read and its separate Playwright Stop.
 */
describe('#1897 — Stop is one atomic check-and-click; a replacement take never receives it', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-18T12:00:00Z')); });
    afterEach(() => { vi.useRealTimers(); });

    const replace = (a: ModelApp) => { a.debug = { lifecycleVersion: a.debug.lifecycleVersion + 7, sessionId: 'row-replacement' }; };
    /** pageOf, plus a hook that runs right AFTER a chosen in-page function returns, or right BEFORE it runs. */
    const hookedPage = (hook: { after?: (fn: unknown) => void; before?: (fn: unknown) => void }): Page => ({
        evaluate: async <A, R>(fn: (arg: A) => R, arg: A) => { hook.before?.(fn); const r = fn(arg); hook.after?.(fn); return r; },
        waitForTimeout: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    } as unknown as Page);
    const liveTake = async (app: ModelApp, page: Page, label: string) => {
        const armed = await armTakeMonitor(page, label);
        app.press(500);
        const hold = await run(holdMeasuredLiveTake(page, armed, LIVE_SECONDS));
        expect(hold.ended).toBe('held');
        return { armed, hold };
    };

    it('FORCED RACE (measured takes): a replacement right after the last read gets ZERO clicks; nothing is confirmed or saved', async () => {
        const app = new ModelApp();
        let armRace = false;
        const page = hookedPage({ after: (fn) => { if (armRace && fn === readTakeMonitorInPage) { armRace = false; replace(app); } } });
        const { armed, hold } = await liveTake(app, page, 'race-measured');
        armRace = true;
        let confirmed = 0;
        const stop = await run(stopMeasuredTake(page, armed, hold, async () => { confirmed += 1; }));
        const snap = await readTakeMonitor(page, armed.token);
        log('forced_race_measured', { stop, stops: snap?.stops.length });
        expect(armRace).toBe(false); // the race really fired between the read and the click step
        expect(stop).toEqual({ pressed: false, reason: 'take_replaced' });
        expect(confirmed).toBe(0);
        expect(app.stopped).toBe(false);
        expect(snap?.stops).toEqual([]);
    });

    it('MECHANISM: f2bb1ae\'s read-then-separate-click, under the same forced race, stops the REPLACEMENT take', async () => {
        const app = new ModelApp();
        let armRace = false;
        const page = hookedPage({ after: (fn) => { if (armRace && fn === readTakeMonitorInPage) { armRace = false; replace(app); } } });
        const { armed, hold } = await liveTake(app, page, 'race-mechanism');
        armRace = true;
        // f2bb1ae verbatim in behaviour: guard on a snapshot, then await the generic Playwright Stop as a separate step.
        const guard = stopGuardVerdict(hold, await readTakeMonitor(page, armed.token));
        if (guard.pressed) await Promise.resolve().then(() => app.stopButton.click());
        const snap = await readTakeMonitor(page, armed.token);
        log('forced_race_mechanism', { guard, stopKey: snap?.stops[0]?.key, heldKey: hold.takeKey });
        expect(guard.pressed).toBe(true);
        expect(app.stopped).toBe(true);
        expect(snap?.stops[0].key).not.toBe(hold.takeKey); // the click landed on the replacement
    });

    it('FORCED RACE (first Focus and Open Mic takes): a replacement just before the page task gets ZERO clicks', async () => {
        for (const [name, swap, reason] of [
            ['replaced', (a: ModelApp) => replace(a), 'take_replaced'],
            // A drop and resume inside one task: the observer has not seen it, only the drained records show it.
            ['dropped_and_resumed', (a: ModelApp) => { a.shell.setAttribute('data-session-state', 'before'); a.shell.setAttribute('data-session-state', 'during'); }, 'capture_dropped'],
            ['ended', (a: ModelApp) => { a.shell.setAttribute('data-session-state', 'after'); }, 'capture_dropped'],
        ] as const) {
            const app = new ModelApp();
            let armRace = false;
            const page = hookedPage({ before: (fn) => { if (armRace && fn === guardedStopInPage) { armRace = false; swap(app); } } });
            const armed = await armTakeMonitor(page, name);
            app.press(500);
            await vi.advanceTimersByTimeAsync(5_000);
            armRace = true;
            let confirmed = 0;
            const stop = await run(stopMonitoredTake(page, armed, async () => { confirmed += 1; }));
            const snap = await readTakeMonitor(page, armed.token);
            log('forced_race_monitored', { name, stop, stops: snap?.stops.length });
            expect(armRace).toBe(false);
            expect(stop).toEqual({ pressed: false, reason });
            expect(confirmed).toBe(0);
            expect(app.stopped).toBe(false);
            expect(snap?.stops).toEqual([]);
        }
    });

    it('the same take, still live: exactly one click, on that take, and only then the confirmation', async () => {
        const app = new ModelApp();
        const page = pageOf();
        const armed = await armTakeMonitor(page, 'first');
        app.press(500);
        await vi.advanceTimersByTimeAsync(5_000);
        const order: string[] = [];
        app.stopButton.addEventListener('click', () => order.push('click'));
        const stop = await run(stopMonitoredTake(page, armed, async () => { order.push(`confirm:${app.stopped}`); }));
        const snap = await readTakeMonitor(page, armed.token);
        expect(stop).toEqual({ pressed: true, reason: 'held_and_live' });
        expect(order).toEqual(['click', 'confirm:true']);
        expect(snap?.stops.map((x) => [x.key, x.state])).toEqual([['take:2', 'during']]);
    });

    it('zero-click controls: never live, a second Stop, a wrong key, a foreign token, an unreadable page', async () => {
        // Never live.
        let app = new ModelApp();
        let page = pageOf();
        let armed = await armTakeMonitor(page, 'never');
        app.press(null);
        expect(await run(guardedStopClick(page, armed, null))).toEqual({ pressed: false, reason: 'capture_never_live' });
        expect(app.stopped).toBe(false);
        // A Stop already pressed on this take (the app ignored it): never a second press.
        app = new ModelApp();
        page = pageOf();
        armed = await armTakeMonitor(page, 'twice');
        app.press(0);
        await vi.advanceTimersByTimeAsync(1_000);
        app.stopped = true;
        app.stopButton.click();
        let clicks = 0;
        app.stopButton.addEventListener('click', () => { clicks += 1; });
        expect(await run(guardedStopClick(page, armed, null))).toEqual({ pressed: false, reason: 'already_stopped' });
        expect(clicks).toBe(0);
        // The held take's key is not the take that went live.
        app = new ModelApp();
        page = pageOf();
        armed = await armTakeMonitor(page, 'key');
        app.press(0);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await run(guardedStopClick(page, armed, 'take:99'))).toEqual({ pressed: false, reason: 'take_replaced' });
        expect(app.stopped).toBe(false);
        // A foreign token, a disposed monitor, a missing monitor: nothing to bind, nothing clicked.
        expect(guardedStopInPage({ token: 'other', expectedKey: null })).toEqual({ clicked: false, reason: 'monitor_unreadable' });
        await disposeTakeMonitor(page, armed.token);
        expect(guardedStopInPage({ token: armed.token, expectedKey: null })).toEqual({ clicked: false, reason: 'monitor_unreadable' });
        delete (window as unknown as Record<string, unknown>).__SS_LIVE_TAKE_MONITOR__;
        expect(guardedStopInPage({ token: armed.token, expectedKey: null })).toEqual({ clicked: false, reason: 'monitor_unreadable' });
        expect(app.stopped).toBe(false);
        // An unreadable page or an unknown page answer is never a press.
        const broken = { evaluate: async () => { throw new Error('detached'); }, waitForTimeout: async () => undefined } as unknown as Page;
        expect(await guardedStopClick(broken, { ...armed, ok: true }, null)).toEqual({ pressed: false, reason: 'monitor_unreadable' });
        const odd = { evaluate: async () => ({ clicked: true, reason: 'surprise' }), waitForTimeout: async () => undefined } as unknown as Page;
        expect(await guardedStopClick(odd, { ...armed, ok: true }, null)).toEqual({ pressed: false, reason: 'monitor_unreadable' });
        expect(await guardedStopClick(pageOf(), { ...armed, ok: false }, null)).toEqual({ pressed: false, reason: 'monitor_unreadable' });
        let confirmed = 0;
        expect(await stopMonitoredTake(pageOf(), { ...armed, ok: false }, async () => { confirmed += 1; })).toEqual({ pressed: false, reason: 'monitor_unreadable' });
        expect(confirmed).toBe(0);
    });

    it('Stop disabled: retried as fresh atomic checks only while disabled; never clicked disabled; times out with zero clicks', async () => {
        let app = new ModelApp();
        let page = pageOf();
        let armed = await armTakeMonitor(page, 'disabled');
        app.press(0);
        await vi.advanceTimersByTimeAsync(1_000);
        app.stopButton.disabled = true;
        expect(await run(guardedStopClick(page, armed, null, { enabledTimeoutMs: 1_000 }), 5_000)).toEqual({ pressed: false, reason: 'stop_unavailable' });
        expect(app.stopped).toBe(false);
        expect((await readTakeMonitor(page, armed.token))?.stops).toEqual([]);
        // Enabled after 600 ms: one click, on the same take.
        app = new ModelApp();
        page = pageOf();
        armed = await armTakeMonitor(page, 'enabled-later');
        app.press(0);
        await vi.advanceTimersByTimeAsync(1_000);
        app.stopButton.disabled = true;
        setTimeout(() => { app.stopButton.disabled = false; }, 600);
        expect(await run(guardedStopClick(page, armed, 'take:2', { enabledTimeoutMs: 2_000 }), 5_000)).toEqual({ pressed: true, reason: 'held_and_live' });
        expect((await readTakeMonitor(page, armed.token))?.stops.map((x) => x.key)).toEqual(['take:2']);
        // Replaced while Stop was disabled: the retry re-checks and clicks nothing.
        app = new ModelApp();
        page = pageOf();
        armed = await armTakeMonitor(page, 'replaced-while-disabled');
        app.press(0);
        await vi.advanceTimersByTimeAsync(1_000);
        app.stopButton.disabled = true;
        setTimeout(() => { replace(app); app.stopButton.disabled = false; }, 300);
        expect(await run(guardedStopClick(page, armed, 'take:2', { enabledTimeoutMs: 2_000 }), 5_000)).toEqual({ pressed: false, reason: 'take_replaced' });
        expect(app.stopped).toBe(false);
        // aria-disabled counts as disabled too.
        app = new ModelApp();
        page = pageOf();
        armed = await armTakeMonitor(page, 'aria');
        app.press(0);
        await vi.advanceTimersByTimeAsync(1_000);
        app.stopButton.setAttribute('aria-disabled', 'true');
        expect(await run(guardedStopClick(page, armed, null, { enabledTimeoutMs: 300 }), 2_000)).toEqual({ pressed: false, reason: 'stop_unavailable' });
        expect(app.stopped).toBe(false);
        // No Stop on the page at all.
        app.stopButton.remove();
        expect(await run(guardedStopClick(page, armed, null, { enabledTimeoutMs: 300 }), 2_000)).toEqual({ pressed: false, reason: 'stop_unavailable' });
    });
});
