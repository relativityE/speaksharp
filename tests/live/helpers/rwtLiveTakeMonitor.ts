/**
 * #1882 live timing evidence (Sam's Nov 18 reset, row 3): the switch take's hold must be MEASURED, not claimed.
 *
 * main's `holdLiveTake` waited for the live take once, then slept `liveSeconds` and reported `heldLiveSeconds: liveSeconds`
 * as fact. Nothing looked at the page again before Stop, so a capture that dropped and resumed, a take replaced by another,
 * or a Stop pressed after capture ended all still read as "nine live seconds".
 *
 * This module measures the take on the page itself:
 *   - an in-page monitor, armed BEFORE the Start press, records every edge of the page's own live state
 *     (`[data-testid=session-shell][data-session-state=during]`, which the app renders only while listening AND capture is
 *     live) together with the take's identity (`__SPEECH_RUNTIME_DEBUG__().lifecycleVersion`, the controller's own
 *     same-take fence). A MutationObserver catches every committed change and a 100 ms tick catches identity changes that
 *     render nothing; tick gaps are recorded, so a frozen page can never be read as continuous;
 *   - a capture-phase click listener on `recorder-stop` records the state and identity AT the actual Stop press, in the same
 *     event dispatch as the app's own handler, so a take replaced between the last check and Stop cannot pass;
 *   - the app's "Session too short" status and the saved-session marker are recorded too, so a discarded take is observable
 *     at once (no 180 s wait for a save candidate that never comes) and a saved row is bound to THIS take's Stop.
 *
 * Every clock in the verdict is the page's own Date.now (the clock the app's live timer uses); the Node-side press time is
 * only a fallback when the Start press happened inside a helper the monitor could not see.
 *
 * Read-only: nothing here presses anything except through the caller's own Stop, so the Start-press budget is unchanged.
 */
import type { Page } from '@playwright/test';

export const TAKE_MONITOR_KEY = '__SS_LIVE_TAKE_MONITOR__';
export const SHELL_SELECTOR = '[data-testid="session-shell"]';
export const STOP_TEST_ID = 'recorder-stop';
export const STATUS_TEST_ID = 'session-status-indicator';
/** useSessionLifecycle's own too-short status ("⚠️ Session too short (Ns)…"): the take was discarded, nothing will save. */
export const TOO_SHORT_TEXT = 'Session too short';
/** A gap longer than this between monitor ticks means the page was not observed continuously. */
export const MAX_TICK_GAP_MS = 1_000;

export interface MonitorConfig {
    token: string;
    shellSelector: string;
    stopTestId: string;
    statusTestId: string;
    tooShortText: string;
    tickMs: number;
    maxTickGapMs: number;
}

/** One observed edge: the page's live state and the take identity at that instant. */
/** `seq` orders every record the monitor makes (edges, Stop presses, saved markers, too-short): two records in the same
 *  millisecond are still ordered as they happened. */
export interface MonitorEdge { seq: number; t: number; state: string | null; key: string | null; sessionId: string | null }
export interface MonitorStop extends MonitorEdge { appStartTime: number | null }
export interface MonitorPersisted { seq: number; t: number; persisted: string | null; id: string | null }
export interface MonitorSnapshot {
    token: string;
    armedAt: number;
    edges: MonitorEdge[];
    stops: MonitorStop[];
    persisted: MonitorPersisted[];
    tooShort: { seq: number; t: number; key: string | null } | null;
    seq: number;
    tickGaps: Array<{ from: number; to: number }>;
    lastTick: number;
    disposed: boolean;
}

/**
 * Runs IN THE PAGE (serialised by Playwright, so it must not close over anything). Idempotent per token: arming again with
 * a new token replaces the previous monitor.
 */
export function installTakeMonitor(cfg: MonitorConfig): { ok: boolean; reason?: string } {
    const w = window as unknown as Record<string, unknown>;
    const previous = w.__SS_LIVE_TAKE_MONITOR__ as { dispose?: () => void } | undefined;
    previous?.dispose?.();
    const debugOf = () => {
        try {
            const fn = (window as unknown as { __SPEECH_RUNTIME_DEBUG__?: () => { lifecycleVersion?: unknown; sessionId?: unknown } }).__SPEECH_RUNTIME_DEBUG__;
            return fn ? fn() : null;
        } catch { return null; }
    };
    const read = (): Omit<MonitorEdge, 't' | 'seq'> => {
        const shell = document.querySelector(cfg.shellSelector);
        const state = shell ? shell.getAttribute('data-session-state') : null;
        const debug = debugOf();
        const version = debug ? debug.lifecycleVersion : undefined;
        const key = typeof version === 'number' ? `take:${version}` : null;
        const sessionId = debug && typeof debug.sessionId === 'string' ? debug.sessionId : null;
        return { state, key, sessionId };
    };
    const snap: MonitorSnapshot = {
        token: cfg.token, armedAt: Date.now(), edges: [], stops: [], persisted: [], tooShort: null, tickGaps: [], lastTick: Date.now(), disposed: false, seq: 0,
    };
    const html = document.documentElement;
    let lastPersisted = `${html.getAttribute('data-session-persisted')}|${html.getAttribute('data-session-persisted-id')}`;
    snap.persisted.push({ seq: ++snap.seq, t: snap.armedAt, persisted: html.getAttribute('data-session-persisted'), id: html.getAttribute('data-session-persisted-id') });
    const observe = () => {
        if (snap.disposed) return;
        const now = Date.now();
        const cur = read();
        const last = snap.edges[snap.edges.length - 1];
        if (!last || last.state !== cur.state || last.key !== cur.key) snap.edges.push({ seq: ++snap.seq, t: now, ...cur });
        else if (cur.sessionId && last.sessionId !== cur.sessionId) last.sessionId = cur.sessionId;
        const p = `${html.getAttribute('data-session-persisted')}|${html.getAttribute('data-session-persisted-id')}`;
        if (p !== lastPersisted) {
            lastPersisted = p;
            snap.persisted.push({ seq: ++snap.seq, t: now, persisted: html.getAttribute('data-session-persisted'), id: html.getAttribute('data-session-persisted-id') });
        }
        if (!snap.tooShort) {
            const status = document.querySelector(`[data-testid="${cfg.statusTestId}"]`);
            if (status && (status.textContent ?? '').includes(cfg.tooShortText)) snap.tooShort = { seq: ++snap.seq, t: now, key: cur.key };
        }
    };
    const observer = new MutationObserver(observe);
    observer.observe(html, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ['data-session-state', 'data-session-persisted', 'data-session-persisted-id'] });
    const tick = setInterval(() => {
        const now = Date.now();
        if (now - snap.lastTick > cfg.maxTickGapMs) snap.tickGaps.push({ from: snap.lastTick, to: now });
        snap.lastTick = now;
        observe();
    }, cfg.tickMs);
    const onClick = (event: Event) => {
        const target = event.target as Element | null;
        if (!target || typeof target.closest !== 'function' || !target.closest(`[data-testid="${cfg.stopTestId}"]`)) return;
        observe();
        let appStartTime: number | null = null;
        try {
            const store = (window as unknown as { useSessionStore?: { getState?: () => { startTime?: unknown } } }).useSessionStore;
            const st = store?.getState?.().startTime;
            appStartTime = typeof st === 'number' ? st : null;
        } catch { appStartTime = null; }
        snap.stops.push({ seq: ++snap.seq, t: Date.now(), ...read(), appStartTime });
    };
    window.addEventListener('click', onClick, true);
    observe();
    w.__SS_LIVE_TAKE_MONITOR__ = {
        token: cfg.token,
        snapshot: () => JSON.parse(JSON.stringify(snap)) as MonitorSnapshot,
        dispose: () => {
            if (snap.disposed) return;
            observe();
            snap.disposed = true;
            observer.disconnect();
            clearInterval(tick);
            window.removeEventListener('click', onClick, true);
        },
    };
    return { ok: true };
}

/** Runs IN THE PAGE. Null when no monitor with this token is armed. */
export function readTakeMonitorInPage(token: string): MonitorSnapshot | null {
    const m = (window as unknown as { __SS_LIVE_TAKE_MONITOR__?: { token: string; snapshot: () => MonitorSnapshot } }).__SS_LIVE_TAKE_MONITOR__;
    return m && m.token === token ? m.snapshot() : null;
}

/** Runs IN THE PAGE. */
export function disposeTakeMonitorInPage(token: string): boolean {
    const m = (window as unknown as { __SS_LIVE_TAKE_MONITOR__?: { token: string; dispose: () => void } }).__SS_LIVE_TAKE_MONITOR__;
    if (!m || m.token !== token) return false;
    m.dispose();
    return true;
}

export interface ArmedTakeMonitor { token: string; ok: boolean; reason?: string; nodePressedAt: number | null }

let tokenSeq = 0;
/** Arm BEFORE the Start press (or before any helper that may press Start itself). */
export async function armTakeMonitor(page: Page, label: string): Promise<ArmedTakeMonitor> {
    tokenSeq += 1;
    const token = `${label}:${Date.now()}:${tokenSeq}`;
    const cfg: MonitorConfig = { token, shellSelector: SHELL_SELECTOR, stopTestId: STOP_TEST_ID, statusTestId: STATUS_TEST_ID,
        tooShortText: TOO_SHORT_TEXT, tickMs: 100, maxTickGapMs: MAX_TICK_GAP_MS };
    const armed = await page.evaluate(installTakeMonitor, cfg).catch((e: unknown) => ({ ok: false, reason: String(e) }));
    return { token, ok: armed.ok, reason: armed.reason, nodePressedAt: null };
}

export async function readTakeMonitor(page: Page, token: string): Promise<MonitorSnapshot | null> {
    return page.evaluate(readTakeMonitorInPage, token).catch(() => null);
}

export async function disposeTakeMonitor(page: Page, token: string): Promise<void> {
    await page.evaluate(disposeTakeMonitorInPage, token).catch(() => undefined);
}

/** The first observed live edge after arming: state `during` with a named take. */
export function firstLiveEdge(snap: MonitorSnapshot): MonitorEdge | null {
    return snap.edges.find((e) => e.state === 'during' && e.key !== null) ?? null;
}

/** The first edge recorded after `live` and before record `untilSeq` that leaves THAT take live (state or take changed). */
export function firstBreakAfter(snap: MonitorSnapshot, live: MonitorEdge, untilSeq: number): MonitorEdge | null {
    return snap.edges.find((e) => e.seq > live.seq && e.seq < untilSeq && (e.state !== 'during' || e.key !== live.key)) ?? null;
}

export interface MeasuredHold {
    /** Page-clock ms from the press to the first observed live edge; null when it never went live in budget. */
    pressToLiveMs: number | null;
    /** Live ms measured on the page from the live edge to the end of the hold (NOT a claim: read from the monitor). */
    measuredLiveMs: number;
    /** Why the hold ended early, if it did. The caller still presses Stop only through its own Stop step. */
    ended: 'held' | 'capture_never_live' | 'capture_dropped' | 'take_replaced' | 'monitor_unreadable';
    takeKey: string | null;
}

/**
 * Wait for the take to go live, then hold it for `liveSeconds` MEASURED from the observed live edge on the page clock,
 * re-reading the monitor every `pollMs`. Returns early (without sleeping out the rest) when capture drops or the take
 * changes, so the evidence records the break rather than a full hold.
 */
export async function holdMeasuredLiveTake(page: Page, armed: ArmedTakeMonitor, liveSeconds: number,
    opts: { liveTimeoutMs?: number; pollMs?: number; nodePressedAt?: number } = {}): Promise<MeasuredHold> {
    if (!Number.isFinite(liveSeconds) || liveSeconds <= 0) throw new Error('INVALID_SETUP live take seconds must be finite and positive');
    if (!armed.ok) return { pressToLiveMs: null, measuredLiveMs: 0, ended: 'monitor_unreadable', takeKey: null };
    const pollMs = opts.pollMs ?? 250;
    const liveDeadline = Date.now() + (opts.liveTimeoutMs ?? 60_000);
    let snap = await readTakeMonitor(page, armed.token);
    let live = snap ? firstLiveEdge(snap) : null;
    while (!live && Date.now() < liveDeadline) {
        await page.waitForTimeout(pollMs);
        snap = await readTakeMonitor(page, armed.token);
        if (!snap) return { pressToLiveMs: null, measuredLiveMs: 0, ended: 'monitor_unreadable', takeKey: null };
        live = firstLiveEdge(snap);
    }
    if (!snap || !live) return { pressToLiveMs: null, measuredLiveMs: 0, ended: snap ? 'capture_never_live' : 'monitor_unreadable', takeKey: null };
    const pressedAt = opts.nodePressedAt ?? null;
    const pressToLiveMs = pressedAt === null ? null : Math.max(0, live.t - pressedAt);
    const target = live.t + Math.round(liveSeconds * 1000);
    for (;;) {
        const now = snap.lastTick > 0 ? Math.max(snap.lastTick, ...snap.edges.map((e) => e.t)) : Date.now();
        const broke = firstBreakAfter(snap, live, Number.POSITIVE_INFINITY);
        if (broke) {
            return { pressToLiveMs, measuredLiveMs: broke.t - live.t, ended: broke.state === 'during' && broke.key !== live.key ? 'take_replaced' : 'capture_dropped', takeKey: live.key };
        }
        if (now >= target) return { pressToLiveMs, measuredLiveMs: now - live.t, ended: 'held', takeKey: live.key };
        await page.waitForTimeout(Math.min(pollMs, Math.max(1, target - now)));
        const next = await readTakeMonitor(page, armed.token);
        if (!next) return { pressToLiveMs, measuredLiveMs: 0, ended: 'monitor_unreadable', takeKey: live.key };
        snap = next;
    }
}

export interface GuardedStop {
    /** True only when the Stop step was actually run for this take. */
    pressed: boolean;
    reason: 'held_and_live' | Exclude<MeasuredHold['ended'], 'held'>;
}

/**
 * Pure. #1897 review 2 (Sam, Nov 18): may the journey press Stop on this take? Only when the hold reports `held` AND a fresh
 * monitor read still shows the SAME take live, with no drop or replacement since its live edge. A hold that ended early
 * (capture dropped, take replaced, never live, unreadable) never leads to a Stop press: the generic Stop would land on
 * whatever take is live now, which may be a replacement, and its result would be read as this take's.
 */
export function stopGuardVerdict(hold: MeasuredHold, snap: MonitorSnapshot | null): GuardedStop {
    if (hold.ended !== 'held') return { pressed: false, reason: hold.ended };
    if (!snap) return { pressed: false, reason: 'monitor_unreadable' };
    const live = firstLiveEdge(snap);
    if (!live || hold.takeKey === null || live.key !== hold.takeKey) return { pressed: false, reason: 'take_replaced' };
    const broke = firstBreakAfter(snap, live, Number.POSITIVE_INFINITY);
    if (broke) return { pressed: false, reason: broke.state === 'during' && broke.key !== live.key ? 'take_replaced' : 'capture_dropped' };
    return { pressed: true, reason: 'held_and_live' };
}

/**
 * Press Stop (through the caller's own Stop step) only when `stopGuardVerdict` allows it on a fresh read of the monitor.
 * Otherwise nothing is pressed, and the take's rows record the break with no Stop press.
 */
export async function stopMeasuredTake(page: Page, armed: ArmedTakeMonitor, hold: MeasuredHold, pressStop: () => Promise<unknown>): Promise<GuardedStop> {
    const guard = stopGuardVerdict(hold, armed.ok ? await readTakeMonitor(page, armed.token) : null);
    if (!guard.pressed) return guard;
    await pressStop();
    return guard;
}

export type TakeOutcome =
    | { kind: 'saved'; id: string; t: number; seq: number }
    | { kind: 'too_short'; t: number; seq: number }
    | { kind: 'unsettled' };

/**
 * After the caller's Stop: the take's terminal result as the page showed it, whichever comes first — the saved marker set
 * AFTER this take's Stop press, or the app's too-short status. A too-short discard is observable even when no save
 * candidate ever appears.
 */
export async function awaitTakeOutcome(page: Page, token: string, timeoutMs: number, pollMs = 250): Promise<TakeOutcome> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const snap = await readTakeMonitor(page, token);
        const outcome = snap ? takeOutcomeOf(snap) : { kind: 'unsettled' as const };
        if (outcome.kind !== 'unsettled' || Date.now() >= deadline) return outcome;
        await page.waitForTimeout(pollMs);
    }
}

/** Pure: the first terminal result after the first Stop press. */
export function takeOutcomeOf(snap: MonitorSnapshot): TakeOutcome {
    const stop = snap.stops[0];
    if (!stop) return { kind: 'unsettled' };
    const saved = snap.persisted.find((p) => p.seq > stop.seq && p.persisted === 'true' && typeof p.id === 'string' && p.id !== '');
    const tooShort = snap.tooShort && snap.tooShort.seq > stop.seq ? snap.tooShort : null;
    if (saved && (!tooShort || saved.seq < tooShort.seq)) return { kind: 'saved', id: saved.id as string, t: saved.t, seq: saved.seq };
    if (tooShort) return { kind: 'too_short', t: tooShort.t, seq: tooShort.seq };
    return { kind: 'unsettled' };
}

export type Verdict = 'PASS' | 'FAIL' | 'HOLD';

export interface LiveTakeVerdict {
    verdict: Verdict;
    reason: 'live_through_stop' | 'capture_never_live' | 'no_stop_press' | 'capture_dropped' | 'take_replaced'
        | 'capture_not_live_at_stop' | 'take_replaced_before_stop' | 'hold_short' | 'monitor_gap' | 'monitor_unreadable' | 'too_short'
        | 'stop_count';
    takeKey: string | null;
    pressToLiveMs: number | null;
    /** Page-clock seconds from the first live edge to the actual Stop press (measured). */
    liveSecondsAtStop: number;
    /** The app's own elapsed seconds at Stop (floored, as useSessionLifecycle floors it); null when its store is not exposed. */
    appElapsedSecondsAtStop: number | null;
    breakAtSeconds: number | null;
    stopPresses: number;
}

/**
 * Pure. PASS only when ONE take went live, stayed live with the same identity, observed without a tick gap, until the
 * actual Stop press, which itself saw that same take live, at least `liveSeconds` after the live edge, and the app did not
 * report the take too short. Anything the monitor could not see is HOLD, never PASS.
 * #1897 review 3 (Sam, Nov 18): exactly ONE Stop press per take. A second press (a Stop on a replacement take, or a
 * repeated press) FAILs `stop_count`: the take's evidence must come from one press, never the first of several.
 */
export function liveTakeVerdict(snap: MonitorSnapshot | null, opts: { liveSeconds: number; pressedAt?: number | null }): LiveTakeVerdict {
    const base = { takeKey: null, pressToLiveMs: null, liveSecondsAtStop: 0, appElapsedSecondsAtStop: null, breakAtSeconds: null, stopPresses: snap?.stops.length ?? 0 };
    if (!snap) return { ...base, verdict: 'HOLD', reason: 'monitor_unreadable' };
    const live = firstLiveEdge(snap);
    if (!live) return { ...base, verdict: 'FAIL', reason: 'capture_never_live' };
    const pressToLiveMs = typeof opts.pressedAt === 'number' ? Math.max(0, live.t - opts.pressedAt) : null;
    const withLive = { ...base, takeKey: live.key, pressToLiveMs };
    const stop = snap.stops.find((s) => s.seq > live.seq);
    const until = stop ? stop.seq : Number.POSITIVE_INFINITY;
    const broke = firstBreakAfter(snap, live, until);
    if (broke) {
        const reason = broke.state === 'during' && broke.key !== live.key ? 'take_replaced' : 'capture_dropped';
        return { ...withLive, verdict: 'FAIL', reason, breakAtSeconds: (broke.t - live.t) / 1000,
            liveSecondsAtStop: stop ? (stop.t - live.t) / 1000 : 0 };
    }
    if (!stop) return { ...withLive, verdict: 'FAIL', reason: 'no_stop_press' };
    if (snap.stops.length !== 1) return { ...withLive, verdict: 'FAIL', reason: 'stop_count', liveSecondsAtStop: (stop.t - live.t) / 1000 };
    const liveSecondsAtStop = (stop.t - live.t) / 1000;
    const appElapsedSecondsAtStop = stop.appStartTime === null ? null : Math.floor((stop.t - stop.appStartTime) / 1000);
    const measured = { ...withLive, liveSecondsAtStop, appElapsedSecondsAtStop };
    // The Stop press's own reading, taken in the same event dispatch as the app's handler.
    if (stop.state !== 'during') return { ...measured, verdict: 'FAIL', reason: 'capture_not_live_at_stop' };
    if (stop.key !== live.key) return { ...measured, verdict: 'FAIL', reason: 'take_replaced_before_stop' };
    if (snap.tooShort && snap.tooShort.seq > stop.seq) return { ...measured, verdict: 'FAIL', reason: 'too_short' };
    if (liveSecondsAtStop < opts.liveSeconds) return { ...measured, verdict: 'FAIL', reason: 'hold_short' };
    if (snap.tickGaps.some((g) => g.to > live.t && g.from < stop.t)) return { ...measured, verdict: 'HOLD', reason: 'monitor_gap' };
    return { ...measured, verdict: 'PASS', reason: 'live_through_stop' };
}

export interface SavedBinding {
    verdict: Verdict;
    reason: 'bound' | 'not_saved' | 'too_short' | 'stale_marker' | 'session_id_mismatch' | 'another_take_before_save' | 'no_stop_press'
        | 'stop_count' | 'session_id_missing';
    persistedId: string | null;
}

/**
 * Pure. The saved row is THIS take's only when the saved marker was set after this take's ONE Stop press with an id, no
 * other take went live between that Stop and the marker, and the id is exactly the non-empty session id the controller
 * named at that Stop. A marker already present at arming that never changed is stale, never this take's.
 * #1897 review 3 (Sam, Nov 18): a missing or empty session id at Stop can never pass (it used to skip the comparison), and
 * more than one Stop press FAILs `stop_count`.
 */
export function savedTakeBinding(snap: MonitorSnapshot | null): SavedBinding {
    if (!snap || snap.stops.length === 0) return { verdict: 'FAIL', reason: 'no_stop_press', persistedId: null };
    if (snap.stops.length !== 1) return { verdict: 'FAIL', reason: 'stop_count', persistedId: null };
    const stop = snap.stops[0];
    const outcome = takeOutcomeOf(snap);
    if (outcome.kind === 'too_short') return { verdict: 'FAIL', reason: 'too_short', persistedId: null };
    if (outcome.kind !== 'saved') {
        const stale = snap.persisted.length === 1 && snap.persisted[0].persisted === 'true';
        return { verdict: 'FAIL', reason: stale ? 'stale_marker' : 'not_saved', persistedId: null };
    }
    const otherLive = snap.edges.some((e) => e.seq > stop.seq && e.seq < outcome.seq && e.state === 'during' && e.key !== stop.key);
    if (otherLive) return { verdict: 'FAIL', reason: 'another_take_before_save', persistedId: outcome.id };
    if (typeof stop.sessionId !== 'string' || stop.sessionId.trim() === '') return { verdict: 'FAIL', reason: 'session_id_missing', persistedId: outcome.id };
    if (stop.sessionId !== outcome.id) return { verdict: 'FAIL', reason: 'session_id_mismatch', persistedId: outcome.id };
    return { verdict: 'PASS', reason: 'bound', persistedId: outcome.id };
}

/** The receipt the journeys write rows to (RwtReceipt#row). */
export interface TakeRowSink {
    row(step: string, verdict: Verdict, detail: string, evidence?: Record<string, string | number | boolean | null>): void;
}

const TIMING_DETAIL: Record<LiveTakeVerdict['reason'], string> = {
    live_through_stop: 'the same take stayed live, observed continuously, until the actual Stop press, for the measured live time',
    capture_never_live: 'capture never went live after the press',
    no_stop_press: 'no Stop press was observed for the live take',
    capture_dropped: 'capture stopped being live before the Stop press',
    take_replaced: 'a different take replaced the live one before the Stop press',
    capture_not_live_at_stop: 'capture was not live at the Stop press',
    take_replaced_before_stop: 'the Stop press saw a different take than the one that went live',
    hold_short: 'Stop was pressed before the required live time, measured from capture live',
    monitor_gap: 'the page was not observed continuously while the take was live',
    monitor_unreadable: 'the take monitor could not be read',
    too_short: 'the app reported the take too short and saved nothing',
    stop_count: 'more than one Stop press was observed for this take',
};

/**
 * Three receipt rows for one measured take: its live timing, whether the saved row is THIS take's, and that row read back
 * against the run's consent. `readRow` is called only for a bound row; `readback` is the consent verdict on what it returns.
 */
export async function takeEvidenceRows<R>(input: {
    sink: TakeRowSink; name: string; snap: MonitorSnapshot | null; liveSeconds: number; pressedAt: number | null; savedId: string | null;
    readRow: (id: string) => Promise<R | null>;
    readback: (row: R | null, savedId: string, liveSecondsAtStop: number) => { verdict: Verdict; reason: string };
}): Promise<{ timing: LiveTakeVerdict; binding: SavedBinding; readback: { verdict: Verdict; reason: string } }> {
    const timing = liveTakeVerdict(input.snap, { liveSeconds: input.liveSeconds, pressedAt: input.pressedAt });
    input.sink.row(`${input.name} live through Stop`, timing.verdict, TIMING_DETAIL[timing.reason], {
        reason: timing.reason, requiredLiveSeconds: input.liveSeconds, liveSecondsAtStop: timing.liveSecondsAtStop,
        appElapsedSecondsAtStop: timing.appElapsedSecondsAtStop, pressToLiveMs: timing.pressToLiveMs, breakAtSeconds: timing.breakAtSeconds,
        stopPresses: timing.stopPresses, takeKey: timing.takeKey,
    });
    const binding = savedTakeBinding(input.snap);
    const sameId = binding.persistedId !== null && binding.persistedId === input.savedId;
    const boundVerdict: Verdict = binding.verdict === 'PASS' && sameId ? 'PASS' : 'FAIL';
    input.sink.row(`${input.name} saved row is this take`, boundVerdict,
        boundVerdict === 'PASS' ? 'the saved marker was set after this take\'s own Stop press, for the session the journey read'
            : binding.verdict === 'PASS' ? 'the journey read a different saved session than the one this take\'s Stop produced'
                : `the saved row is not bound to this take (${binding.reason})`,
        { reason: binding.verdict === 'PASS' && !sameId ? 'journey_read_other_row' : binding.reason, persistedId: binding.persistedId, savedId: input.savedId });
    let readback: { verdict: Verdict; reason: string } = { verdict: 'FAIL', reason: 'row_not_bound' };
    if (boundVerdict === 'PASS' && input.savedId) readback = input.readback(await input.readRow(input.savedId), input.savedId, timing.liveSecondsAtStop);
    input.sink.row(`${input.name} saved per consent`, readback.verdict, `saved row read back against the run's consent: ${readback.reason}`,
        { reason: readback.reason });
    return { timing, binding, readback };
}
