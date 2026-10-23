/**
 * #1593 ledger case 3 (run 39180659914): the Focus Points marker-timing oracle sampled the rail every 500 ms and stamped a
 * change with the Node clock AFTER sequential row reads, so a transition at 8.90 s and one at 9.10 s could both be first
 * seen at 9.40 s — the original FAIL (9.40 against a 9.02 deadline) could not distinguish a late marker from a late read.
 *
 * This is the take-bound in-page observer (Browser PM handoff 5a86205c §5, Sam's measurement contract): a MutationObserver
 * armed on the rail BEFORE the take can start. Its stamp is PAGE-SIDE OBSERVATION time — when the callback ran, on the same
 * page clock as the microphone log — never the exact mutation time. Nothing is backdated and no latency is subtracted: a
 * delayed callback can only make a marker look later, never earlier, so a delay can never manufacture a PASS.
 *
 * The in-page functions are self-contained (serialised by `page.evaluate`) and are exercised directly under jsdom.
 */
import type { Page } from '@playwright/test';

/**
 * One status a point's row showed, in delivery order; transient statuses inside one batch are kept. The change happened in
 * the conservative interval (afterMs, observedAtMs]: a MutationObserver delivery takes EVERY record queued since the previous
 * delivery, so a change in this batch happened after that delivery and no later than this callback. No exact time is invented.
 */
export interface MarkerObservation {
    point: number;
    status: string;
    /** The previous delivery (or arm): the change happened AFTER this. */
    afterMs: number;
    /** Page `Date.now()` when this callback (or the freeze drain) ran: OBSERVATION time, the latest the change can have been. */
    observedAtMs: number;
    seq: number;
    /** 1 = the rail present at arm; incremented when an expected re-render replaces it. */
    railGeneration: number;
}

export interface MarkerObserverSnapshot {
    token: string;
    armedAtMs: number;
    /** Every row read `pending` at arm (a take that already marked a point is not this take's evidence). */
    initialAllPending: boolean;
    initialStatuses: (string | null)[];
    observations: MarkerObservation[];
    /** Records refused as stale (changed after their row/rail was removed), out of range, or arriving after the freeze. */
    rejected: { reason: 'detached' | 'out-of-range' | 'after-freeze'; point: number | null }[];
    railGenerations: number;
    /** Microphone acquisitions already logged at arm: only a later acquisition can be this take's. */
    acquisitionsAtArm: number;
    /** The microphone log and its invocation stamps, copied in the SAME token-validated evaluation that froze the window. */
    acquisitionLog: { id: number; outcome: string }[];
    acquisitionMarks: number[];
    frozen: boolean;
    frozenAtMs: number | null;
}

interface ObserverState {
    snapshot: MarkerObserverSnapshot;
    observer: MutationObserver | null;
    rail: Element | null;
    last: (string | null)[];
    lastDeliveryAtMs: number;
}

/** In-page: arm the observer on the current rail. Refuses a second live observer and a missing rail. */
export function armMarkerObserverInPage(args: { token: string; count: number; railTestId: string; rowPrefix: string }): { ok: boolean; reason?: string } {
    const w = window as unknown as Record<string, unknown>;
    const existing = w['__rwtMarkerObserver__'] as ObserverState | undefined;
    if (existing && !existing.snapshot.frozen) return { ok: false, reason: existing.snapshot.token === args.token ? 'already-armed' : 'another-observer-active' };
    const rail = document.querySelector(`[data-testid="${args.railTestId}"]`);
    if (!rail) return { ok: false, reason: 'rail-missing' };
    const rowOf = (el: Element): number | null => {
        const id = el.getAttribute('data-testid') ?? '';
        if (!id.startsWith(args.rowPrefix)) return null;
        const n = Number(id.slice(args.rowPrefix.length));
        return Number.isInteger(n) && n >= 0 ? n : null;
    };
    const readStatuses = (container: Element): (string | null)[] => Array.from({ length: args.count }, (_, i) =>
        container.querySelector(`[data-testid="${args.rowPrefix}${i}"]`)?.getAttribute('data-status') ?? null);
    const initial = readStatuses(rail);
    const log = (w['__rwtMicAcquisitionLog__'] as unknown[] | undefined) ?? [];
    const armedAtMs = Date.now();
    const state: ObserverState = {
        snapshot: {
            token: args.token, armedAtMs, initialAllPending: initial.length > 0 && initial.every((s) => s === 'pending'),
            initialStatuses: initial, observations: [], rejected: [], railGenerations: 1, acquisitionsAtArm: log.length,
            acquisitionLog: [], acquisitionMarks: [], frozen: false, frozenAtMs: null,
        },
        observer: null,
        rail,
        last: initial.slice(),
        lastDeliveryAtMs: armedAtMs,
    };
    const s = state.snapshot;
    const record = (point: number, status: string | null, afterMs: number, at: number, railGeneration: number) => {
        if (status === null || status === state.last[point]) return;
        state.last[point] = status;
        s.observations.push({ point, status, afterMs, observedAtMs: at, seq: s.observations.length, railGeneration });
    };
    // An expected re-render may replace the rail: adopt the connected replacement as a new generation.
    const currentRail = (): Element | null => {
        if (state.rail && state.rail.isConnected) return state.rail;
        const next = document.querySelector(`[data-testid="${args.railTestId}"]`);
        if (next && next !== state.rail) {
            state.rail = next;
            s.railGenerations += 1;
        }
        return state.rail && state.rail.isConnected ? state.rail : null;
    };
    const handle = (records: MutationRecord[], at: number) => {
        const afterMs = state.lastDeliveryAtMs;
        state.lastDeliveryAtMs = at;
        if (s.frozen) {
            for (const r of records) s.rejected.push({ reason: 'after-freeze', point: r.target instanceof Element ? rowOf(r.target) : null });
            return;
        }
        // The value an attribute record set is the next record's oldValue for the same row (or the current attribute for
        // the last), so transients inside one batch survive.
        const perRow = new Map<Element, MutationRecord[]>();
        for (const r of records) {
            if (r.type !== 'attributes' || !(r.target instanceof Element)) continue;
            perRow.set(r.target, [...(perRow.get(r.target) ?? []), r]);
        }
        const railAtStart = state.rail;
        const generationAtStart = s.railGenerations;
        const rail = currentRail();
        // Records in DELIVERY ORDER: a row change recorded before its rail's removal is eligible evidence of that rail's
        // generation (the change happened while it was attached); a change recorded after the removal is stale.
        const removed: Node[] = [];
        let structural = false;
        for (const r of records) {
            if (r.type === 'childList') {
                structural = true;
                r.removedNodes.forEach((n) => removed.push(n));
                continue;
            }
            if (r.type !== 'attributes' || !(r.target instanceof Element)) continue;
            const el = r.target;
            const point = rowOf(el);
            if (point === null) continue;
            if (point >= args.count) { s.rejected.push({ reason: 'out-of-range', point }); continue; }
            if (removed.some((n) => n === el || n.contains(el))) { s.rejected.push({ reason: 'detached', point }); continue; }
            const list = perRow.get(el) ?? [r];
            const k = list.indexOf(r);
            // A detached row's current attribute may carry a write made after its removal, so the value its last
            // pre-removal record set is not established: record 'unknown' (never a PASS) rather than guess.
            const value = k + 1 < list.length ? list[k + 1].oldValue : el.isConnected ? el.getAttribute('data-status') : 'unknown';
            if (railAtStart && railAtStart.contains(el)) record(point, value, afterMs, at, generationAtStart);
            else if (rail && el.isConnected && rail.contains(el)) record(point, value, afterMs, at, s.railGenerations);
            else s.rejected.push({ reason: 'detached', point });
        }
        if (structural && rail) readStatuses(rail).forEach((status, i) => record(i, status, afterMs, at, s.railGenerations));
    };
    const observer = new MutationObserver((records) => handle(records, Date.now()));
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status'], attributeOldValue: true });
    state.observer = observer;
    (state as unknown as { drain: () => void }).drain = () => handle(observer.takeRecords(), Date.now());
    w['__rwtMarkerObserver__'] = state;
    return { ok: true };
}

/**
 * In-page: validate the token, drain undelivered records, freeze the live window, disconnect, and copy the microphone log
 * and its stamps in this same evaluation. Idempotent; a sealed window (and its acquisition copy) never changes.
 */
export function freezeMarkerObserverInPage(token: string): MarkerObserverSnapshot | null {
    const w = window as unknown as Record<string, unknown>;
    const state = w['__rwtMarkerObserver__'] as (ObserverState & { drain?: () => void }) | undefined;
    if (!state || state.snapshot.token !== token) return null;
    if (!state.snapshot.frozen) {
        state.drain?.();
        state.snapshot.frozen = true;
        state.snapshot.frozenAtMs = Date.now();
        state.observer?.disconnect();
        state.observer = null;
        const log = (w['__rwtMicAcquisitionLog__'] as { id: number; outcome: string }[] | undefined) ?? [];
        state.snapshot.acquisitionLog = log.map((a) => ({ id: a.id, outcome: a.outcome }));
        state.snapshot.acquisitionMarks = ((w['__rwtMicAcquisitions__'] as number[] | undefined) ?? []).slice();
    }
    return JSON.parse(JSON.stringify(state.snapshot)) as MarkerObserverSnapshot;
}

/** In-page: disconnect and remove. Idempotent; returns whether this token's observer was present. */
export function disposeMarkerObserverInPage(token: string): boolean {
    const w = window as unknown as Record<string, unknown>;
    const state = w['__rwtMarkerObserver__'] as ObserverState | undefined;
    if (!state || state.snapshot.token !== token) return false;
    state.observer?.disconnect();
    state.observer = null;
    state.snapshot.frozen = true;
    delete w['__rwtMarkerObserver__'];
    return true;
}

export const MARKER_RAIL_TEST_ID = 'focus-points-rail';
export const MARKER_ROW_PREFIX = 'focus-point-';

/** Node: arm before anything can start the take. A failure is recorded by the caller as a HOLD, never retried silently. */
export async function armMarkerObserver(page: Page, count: number): Promise<{ token: string; ok: boolean; reason?: string }> {
    const token = `mo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await page.evaluate(armMarkerObserverInPage, { token, count, railTestId: MARKER_RAIL_TEST_ID, rowPrefix: MARKER_ROW_PREFIX })
        .catch(() => ({ ok: false, reason: 'evaluate-failed' }));
    return { token, ...result };
}

const bounded = <T>(work: Promise<T>, ms: number, fallback: T): Promise<T> =>
    Promise.race([work.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

/** Node: freeze before Stop. Null when the document was replaced, the token is foreign, or the page did not answer in time. */
export function freezeMarkerObserver(page: Page, token: string, timeoutMs = 5_000): Promise<MarkerObserverSnapshot | null> {
    return bounded(page.evaluate(freezeMarkerObserverInPage, token), timeoutMs, null);
}

/** Node: bounded, idempotent disposal for the journey's finalizer; a closed or hung page cannot stall finalization. */
export function disposeMarkerObserver(page: Page, token: string | null, timeoutMs = 3_000): Promise<boolean> {
    if (!token) return Promise.resolve(false);
    return bounded(page.evaluate(disposeMarkerObserverInPage, token), timeoutMs, false);
}

export type AcquisitionBinding =
    | { ok: true; id: number; invokedAtMs: number }
    | { ok: false; reason: 'missing' | 'ambiguous' | 'denied' | 'unsettled' | 'unstamped' };

/**
 * Bind the take to ONE fresh granted microphone acquisition: logged after the observer armed, exactly one, and granted.
 * Its stamp is the getUserMedia INVOCATION on the page clock — not proven sample onset — and is labelled so by callers.
 */
export function bindTakeAcquisition(log: readonly { id: number; outcome: string }[], marks: readonly number[], acquisitionsAtArm: number): AcquisitionBinding {
    const fresh = log.filter((a) => a.id >= acquisitionsAtArm);
    if (fresh.length === 0) return { ok: false, reason: 'missing' };
    if (fresh.length > 1) return { ok: false, reason: 'ambiguous' };
    const [only] = fresh;
    if (only.outcome === 'pending') return { ok: false, reason: 'unsettled' };
    if (only.outcome !== 'granted') return { ok: false, reason: 'denied' };
    const at = marks[only.id];
    if (typeof at !== 'number' || !Number.isFinite(at)) return { ok: false, reason: 'unstamped' };
    return { ok: true, id: only.id, invokedAtMs: at };
}

export const MARKER_ALIGNMENT_SLACK_SECONDS = 1;
export const LIVE_MARKER_MAX_AFTER_SECONDS = 5;

/**
 * Per-point timing verdict, unchanged windows and deadlines: a spoken point's first non-pending change must land no earlier
 * than 1 s before its window opens and no later than min(window end + 5 s, next point's start); a never-spoken point must
 * never be marked (a transient counts). Times are page-clock ms after the take's getUserMedia INVOCATION. The change is only
 * known to lie in (afterMs, observedAtMs]: PASS needs the WHOLE interval inside the bounds, an interval wholly outside is a
 * FAIL, and an interval that crosses a boundary is `uncertain-*` (non-PASS). Verdicts carry exact ms bounds as seconds.
 */
export function classifyMarkerTiming(input: {
    windows: readonly ([number, number] | null)[];
    observations: readonly MarkerObservation[];
    invokedAtMs: number;
    expectsLive: readonly boolean[];
}): string[] {
    const first = (i: number) => input.observations.find((o) => o.point === i && o.status !== 'pending') ?? null;
    const nextStart = (i: number): number | null => {
        for (let j = i + 1; j < input.windows.length; j += 1) { const w = input.windows[j]; if (w) return w[0]; }
        return null;
    };
    return input.expectsLive.map((expectsLive, i) => {
        const window = input.windows[i] ?? null;
        const change = first(i);
        const lo = change ? (change.afterMs - input.invokedAtMs) / 1000 : 0;
        const hi = change ? (change.observedAtMs - input.invokedAtMs) / 1000 : 0;
        const bounds = `${lo.toFixed(3)}..${hi.toFixed(3)}`;
        // A pre-removal change whose resulting value is not established is evidence of a write, not of a marker: non-PASS.
        if (window === null) return change ? (change.status === 'unknown' ? `uncertain-unspoken-change@${bounds}` : 'marked-though-never-spoken') : 'ok-unspoken';
        if (!change) return expectsLive ? 'no-live-change' : 'ok-no-change';
        if (change.status === 'unknown') return `uncertain-unknown@${bounds}`;
        const earliest = window[0] - MARKER_ALIGNMENT_SLACK_SECONDS;
        const next = nextStart(i);
        const deadline = Math.min(window[1] + LIVE_MARKER_MAX_AFTER_SECONDS, next ?? Number.POSITIVE_INFINITY);
        if (hi < earliest) return `early@${bounds}`;
        if (lo > deadline) return `late@${bounds}`;
        if (lo >= earliest && hi <= deadline) return `ok@${bounds}`;
        return lo < earliest ? `uncertain-early@${bounds}` : `uncertain-late@${bounds}`;
    });
}

/** Row status: any definite violation FAILs; otherwise any uncertainty is a HOLD; PASS only when every point is ok. */
export function markerTimingStatus(verdicts: readonly string[]): 'PASS' | 'FAIL' | 'HOLD' {
    if (verdicts.some((v) => !v.startsWith('ok') && !v.startsWith('uncertain-'))) return 'FAIL';
    if (verdicts.some((v) => v.startsWith('uncertain-'))) return 'HOLD';
    return 'PASS';
}
