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

/** One status a point's row showed, in delivery order; transient statuses inside one batch are kept. */
export interface MarkerObservation {
    point: number;
    status: string;
    /** Page `Date.now()` when the observer callback ran (or the drain at freeze): OBSERVATION time, not mutation time. */
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
    /** Records refused as stale (detached row/rail), out of range, or arriving after the window froze. */
    rejected: { reason: 'detached' | 'out-of-range' | 'after-freeze'; point: number | null }[];
    railGenerations: number;
    /** Microphone acquisitions already logged at arm: only a later acquisition can be this take's. */
    acquisitionsAtArm: number;
    frozen: boolean;
    frozenAtMs: number | null;
}

interface ObserverState {
    snapshot: MarkerObserverSnapshot;
    observer: MutationObserver | null;
    rail: Element | null;
    last: (string | null)[];
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
    const state: ObserverState = {
        snapshot: {
            token: args.token, armedAtMs: Date.now(), initialAllPending: initial.length > 0 && initial.every((s) => s === 'pending'),
            initialStatuses: initial, observations: [], rejected: [], railGenerations: 1, acquisitionsAtArm: log.length, frozen: false, frozenAtMs: null,
        },
        observer: null,
        rail,
        last: initial.slice(),
    };
    const s = state.snapshot;
    const record = (point: number, status: string | null, at: number) => {
        if (status === null || status === state.last[point]) return;
        state.last[point] = status;
        s.observations.push({ point, status, observedAtMs: at, seq: s.observations.length, railGeneration: s.railGenerations });
    };
    // An expected re-render may replace the rail. Adopt the connected replacement (a new generation) and record any status
    // its rows already show; rows of the detached rail are stale and refused.
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
        if (s.frozen) {
            for (const r of records) s.rejected.push({ reason: 'after-freeze', point: r.target instanceof Element ? rowOf(r.target) : null });
            return;
        }
        // Attribute records per row, in delivery order: each record's oldValue is the status before it, so the value it set
        // is the next record's oldValue (or the current attribute for the last). Transients inside one batch survive.
        const byRow = new Map<Element, MutationRecord[]>();
        let structural = false;
        for (const r of records) {
            if (r.type === 'childList') { structural = true; continue; }
            if (r.type !== 'attributes' || !(r.target instanceof Element)) continue;
            const list = byRow.get(r.target) ?? [];
            list.push(r);
            byRow.set(r.target, list);
        }
        const rail = currentRail();
        for (const [el, list] of byRow) {
            const point = rowOf(el);
            if (point === null) continue;
            if (point >= args.count) { s.rejected.push({ reason: 'out-of-range', point }); continue; }
            if (!rail || !el.isConnected || !rail.contains(el)) { s.rejected.push({ reason: 'detached', point }); continue; }
            list.forEach((r, k) => record(point, k + 1 < list.length ? list[k + 1].oldValue : el.getAttribute('data-status'), at));
        }
        if (structural && rail) readStatuses(rail).forEach((status, i) => record(i, status, at));
    };
    const observer = new MutationObserver((records) => handle(records, Date.now()));
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-status'], attributeOldValue: true });
    state.observer = observer;
    (state as unknown as { drain: () => void }).drain = () => handle(observer.takeRecords(), Date.now());
    w['__rwtMarkerObserver__'] = state;
    return { ok: true };
}

/** In-page: drain undelivered records, freeze the live window and disconnect. Idempotent; a sealed window never changes. */
export function freezeMarkerObserverInPage(token: string): MarkerObserverSnapshot | null {
    const state = (window as unknown as Record<string, unknown>)['__rwtMarkerObserver__'] as (ObserverState & { drain?: () => void }) | undefined;
    if (!state || state.snapshot.token !== token) return null;
    if (!state.snapshot.frozen) {
        state.drain?.();
        state.snapshot.frozen = true;
        state.snapshot.frozenAtMs = Date.now();
        state.observer?.disconnect();
        state.observer = null;
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
 * Per-point timing verdict, unchanged semantics: a spoken point's first non-pending observation must land no earlier than
 * 1 s before its window opens, and no later than min(window end + 5 s, next point's start). A never-spoken point must never
 * be marked (a transient counts). The input time is page-side OBSERVATION time after the getUserMedia invocation.
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
        if (window === null) return change ? 'marked-though-never-spoken' : 'ok-unspoken';
        if (!change) return expectsLive ? 'no-live-change' : 'ok-no-change';
        const audioSec = (change.observedAtMs - input.invokedAtMs) / 1000;
        const latency = (audioSec - window[1]).toFixed(1); // negative = during the point
        const next = nextStart(i);
        const deadline = Math.min(window[1] + LIVE_MARKER_MAX_AFTER_SECONDS, next ?? Number.POSITIVE_INFINITY);
        if (audioSec < window[0] - MARKER_ALIGNMENT_SLACK_SECONDS) return `early@${audioSec.toFixed(1)}`;
        if (audioSec > deadline) return `late@${audioSec.toFixed(1)}(+${latency}s)`;
        return `ok@${audioSec.toFixed(1)}(${latency}s)`;
    });
}
