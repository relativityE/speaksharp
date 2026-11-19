/**
 * AHT-02 / AHT-03, catalog row `focus-next-point-marked` (source receipt row `next point marked`, PO script row 10, "the next
 * point is marked"). Case-only helper for the Focus Points journey.
 *
 * Owner decision (Akin, 2026-11-11): the "Still to cover" marker must ALWAYS be on the first uncovered (first pending) point.
 * Movement is NOT required by this row; that the marker moves as points are heard is judged by the separate live-marker and
 * timing rows (`live marker changes`, `marker timing vs audio`). Before this decision the source row PASSed only when the marker
 * moved (`nextSequence.length > 1`), so a correct rail whose opening point stayed pending FAILed it, and a marker on the wrong
 * point could PASS it.
 *
 * Mirrors the harness reference `markerVerdict` in tools/cloud-test/harness/draft-adapters/focus-oracle.cjs (R5 correction,
 * 2026-10-28), which reads the product rule from frontend/src/utils/focusCoverage.ts: `nextIndex` = the first row whose covered
 * flag is false, a live `partial` counting as covered, and FocusPointsRail shows "Still to cover" on that row only while
 * recording. The harness file stays read-only; tests/unit/rwtFocusNextMarker.test.ts runs both over the same timelines.
 *
 * Verdicts (harness NOT RUN is this receipt's HOLD):
 *  - HOLD when the window is not usable: not frozen, no samples, any unreadable sample, an empty or truncated (200-entry) timeline,
 *    no conclusive sample with a pending point, or (absent a marker defect) contradictory samples (a status going backwards,
 *    timestamps going backwards, the point count changing, a marker outside the rail).
 *  - FAIL when any conclusive sample shows the marker anywhere but the first pending point: on a covered/partial point, on a
 *    later pending point, absent while a point is pending, or shown when nothing is pending; or when a sample shows more than
 *    one marker.
 *  - PASS otherwise. A marker that never moves but is always on the first pending point PASSes.
 */
import type { Page } from '@playwright/test';

/** Statuses a live rail can show while recording. Anything else (`missing`, `none`, unreadable) makes a sample inconclusive. */
const CONCLUSIVE = new Set(['pending', 'partial', 'covered']);
const RANK: Record<string, number> = { pending: 0, partial: 1, covered: 2 };
/** The harness caps the in-page timeline at 200 entries; a timeline that reached the cap is truncated and not judged. */
export const MARKER_TIMELINE_CAP = 200;
/** The harness keeps at most 20 multi-marker samples. */
const MULTI_MARKER_CAP = 20;

/** One timeline entry: [ms since the window opened, the marked point (null = none), the status per point]. */
export type MarkerSample = readonly [ms: number, nextIndex: number | null, statuses: readonly string[]];

export interface MarkerObservation {
    /** The window was closed before it was judged; later reads cannot change it. */
    frozen: boolean;
    /** Every sample attempted, readable or not. */
    samples: number;
    /** Samples (or rows within a sample) that could not be read. */
    unreadable: number;
    /** Written only when the (marker, statuses) pair changes, in time order. */
    timeline: MarkerSample[];
    /** [ms, markers shown] for each sample that showed more than one marker. */
    multiMarker: Array<readonly [number, number]>;
}

export type NextMarkerVerdict = 'PASS' | 'FAIL' | 'HOLD';
export type NextMarkerBasis = 'marker-consistent' | 'marker-wrong' | 'duplicate-marker' | 'contradictory-state' | 'unobserved';

export interface NextMarkerResult {
    verdict: NextMarkerVerdict;
    basis: NextMarkerBasis;
    detail: string;
    evidence: Record<string, string | number | boolean | null>;
}

/** The point the product must mark: the first `pending` row; null when no point is pending. */
export const expectedNextMarker = (statuses: readonly string[]): number | null => {
    const i = statuses.indexOf('pending');
    return i === -1 ? null : i;
};

const isSample = (e: unknown): e is MarkerSample => Array.isArray(e) && e.length === 3 && Number.isFinite(e[0])
    && (e[1] === null || Number.isInteger(e[1])) && Array.isArray(e[2]);
const conclusive = (e: MarkerSample): boolean => e[2].length > 0 && e[2].every((s) => CONCLUSIVE.has(s));

/** The harness `known` gate: a frozen, fully readable, non-empty and untruncated window. */
export const observationUsable = (o: MarkerObservation | null): o is MarkerObservation => !!o && o.frozen === true
    && Number.isInteger(o.samples) && o.samples > 0 && o.unreadable === 0
    && Array.isArray(o.timeline) && o.timeline.length > 0 && o.timeline.length < MARKER_TIMELINE_CAP;

/** Observations that cannot all be true of one correct rail. Never a PASS and never, alone, a product FAIL. */
export function markerContradictions(entries: readonly MarkerSample[]): string[] {
    const kinds = new Set<string>();
    for (let k = 1; k < entries.length; k += 1) {
        if (entries[k][0] < entries[k - 1][0]) kinds.add('timestamps-went-backwards');
        const a = entries[k - 1][2];
        const b = entries[k][2];
        for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
            if (RANK[a[i]] !== undefined && RANK[b[i]] !== undefined && RANK[b[i]] < RANK[a[i]]) kinds.add('status-went-backwards');
        }
        if (a.length !== b.length) kinds.add('point-count-changed');
    }
    if (entries.some((e) => Number.isInteger(e[1]) && ((e[1] as number) < 0 || (e[1] as number) >= e[2].length))) kinds.add('marker-out-of-range');
    return [...kinds].sort();
}

const DETAIL: Record<NextMarkerBasis, string> = {
    'marker-consistent': 'in every sample the "Still to cover" marker was on the first point not yet heard (movement is not required by this row)',
    'marker-wrong': 'a sample showed the "Still to cover" marker on a point other than the first one not yet heard (or a marker with nothing left to cover, or none while a point was still to cover)',
    'duplicate-marker': 'a sample showed more than one "Still to cover" marker',
    'contradictory-state': 'the samples contradict each other (a status went backwards, time went backwards, or the rail changed size), so the marker is not established either way',
    unobserved: 'no usable live sample of the rail with a point still to cover was taken, so the marker is not established either way',
};

/** Judge one frozen live window. Pure: no browser, clock or I/O. */
export function nextPointMarkedVerdict(o: MarkerObservation | null): NextMarkerResult {
    const usable = observationUsable(o);
    const entries = usable ? o.timeline.filter(isSample) : [];
    const good = entries.filter(conclusive);
    const wrong = good.filter((e) => e[1] !== expectedNextMarker(e[2]));
    const duplicates = usable ? (o.multiMarker ?? []).filter((m) => Array.isArray(m) && Number.isInteger(m[1]) && m[1] > 1) : [];
    const withPending = good.filter((e) => expectedNextMarker(e[2]) !== null);
    const contradictions = usable ? markerContradictions(good) : [];

    let verdict: NextMarkerVerdict = 'HOLD';
    let basis: NextMarkerBasis = 'unobserved';
    if (usable && good.length > 0) {
        if (wrong.length > 0) { verdict = 'FAIL'; basis = 'marker-wrong'; }
        else if (duplicates.length > 0) { verdict = 'FAIL'; basis = 'duplicate-marker'; }
        else if (contradictions.length > 0) { verdict = 'HOLD'; basis = 'contradictory-state'; }
        else if (withPending.length > 0) { verdict = 'PASS'; basis = 'marker-consistent'; }
    }
    const marks: number[] = [];
    for (const e of good) if (e[1] !== null && marks[marks.length - 1] !== e[1]) marks.push(e[1]);
    const last = good.length > 0 ? good[good.length - 1] : null;
    // Content-free: point ordinals, closed status words and milliseconds only. Capped so the receipt stays small.
    const timeline = entries.slice(0, 40).map((e) => `${e[0]}:${e[1] ?? '-'}:${e[2].map((s) => s.slice(0, 2)).join('')}`).join(' ');
    return {
        verdict, basis, detail: DETAIL[basis],
        evidence: {
            oracle: 'marker-on-first-uncovered-point', movementRequired: false, basis,
            samples: o && Number.isFinite(o.samples) ? o.samples : null,
            unreadable: o && Number.isFinite(o.unreadable) ? o.unreadable : null,
            frozen: o?.frozen ?? null,
            states: usable ? entries.length : null,
            conclusiveStates: usable ? good.length : null,
            statesWithPendingPoint: usable ? withPending.length : null,
            inconsistentStates: usable ? wrong.length : null,
            firstInconsistentMs: wrong.length > 0 ? wrong[0][0] : null,
            firstInconsistentMarker: wrong.length > 0 ? (wrong[0][1] ?? 'none') : null,
            firstInconsistentExpected: wrong.length > 0 ? (expectedNextMarker(wrong[0][2]) ?? 'none') : null,
            duplicateMarkerSamples: usable ? duplicates.length : null,
            contradictionKinds: usable ? contradictions.join(',') : null,
            markerShownWhileAllCovered: usable ? good.some((e) => expectedNextMarker(e[2]) === null && e[1] !== null) : null,
            finalMarker: last ? (last[1] ?? 'none') : null,
            expectedFinalMarker: last ? (expectedNextMarker(last[2]) ?? 'none') : null,
            // Diagnostic only (the old movement read): the order the marker visited points in.
            markerSequence: marks.join('>'),
            timeline,
        },
    };
}

/** One atomic read of the rail: every row's status and which rows show the marker, from a single page evaluation. */
export interface RailSample { statuses: string[]; markers: number[]; unreadableRows: number }

/**
 * Accumulates the live window from repeated atomic rail reads, the way the harness's in-page sampler does
 * (presentation-controls.cjs `beginFocusLive`): a timeline entry only when (marker, statuses) changes, at most 200 entries,
 * multi-marker samples kept separately, and every unreadable read counted.
 */
export class MarkerTimeline {
    private samples = 0;
    private unreadable = 0;
    private readonly timeline: MarkerSample[] = [];
    private readonly multiMarker: Array<readonly [number, number]> = [];
    private lastKey: string | null = null;
    private frozenAt: MarkerObservation | null = null;

    /** Record one read taken `ms` after the window opened; `null` = the read itself failed. */
    record(ms: number, sample: RailSample | null): void {
        if (this.frozenAt) return;
        this.samples += 1;
        if (!sample) { this.unreadable += 1; return; }
        this.unreadable += sample.unreadableRows;
        const next = sample.markers.length > 0 ? sample.markers[0] : null;
        if (sample.markers.length > 1 && this.multiMarker.length < MULTI_MARKER_CAP) this.multiMarker.push([ms, sample.markers.length]);
        const key = `${next}|${sample.statuses.join(',')}`;
        if (key !== this.lastKey && this.timeline.length < MARKER_TIMELINE_CAP) {
            this.lastKey = key;
            this.timeline.push([ms, next, [...sample.statuses]]);
        }
    }

    /** Close the window; later records are ignored. Idempotent. */
    freeze(): MarkerObservation {
        this.frozenAt ??= { frozen: true, samples: this.samples, unreadable: this.unreadable, timeline: [...this.timeline], multiMarker: [...this.multiMarker] };
        return this.frozenAt;
    }
}

/** A rail row that is not in the DOM. Not a product status, so it is never conclusive (the harness writes `missing`). */
export const ABSENT_ROW = 'absent';
/** The harness bounds every presentation read at 5 s (presentation-controls.cjs `boundedRead`). */
const SAMPLE_BOUND_MS = 5_000;

/**
 * Read the rail once, in one evaluation so statuses and markers cannot tear (the same DOM reads as the harness sampler). A read
 * that fails or exceeds its bound returns null, which the timeline counts as unreadable.
 */
export async function sampleFocusRail(page: Page, count: number): Promise<RailSample | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = page.evaluate(({ n, absent }) => {
        const statuses: string[] = [];
        const markers: number[] = [];
        let unreadableRows = 0;
        for (let i = 0; i < n; i += 1) {
            const row = document.querySelector(`[data-testid="focus-point-${i}"]`);
            if (!row) { unreadableRows += 1; statuses.push(absent); continue; }
            statuses.push(String(row.getAttribute('data-status') || 'none').slice(0, 16));
            if (Array.from(row.querySelectorAll('*')).some((e) => e.textContent?.replace(/\s+/g, ' ').trim() === 'Still to cover')) markers.push(i);
        }
        return { statuses, markers, unreadableRows };
    }, { n: count, absent: ABSENT_ROW });
    const bound = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), SAMPLE_BOUND_MS); });
    try {
        return await Promise.race([read.catch(() => null), bound]);
    } finally { clearTimeout(timer); }
}
