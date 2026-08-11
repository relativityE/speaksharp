/**
 * #1222 — Progress vs baseline (the retired-SpeakSharp-Score replacement).
 *
 * Pure computation of the session-over-session progress metric surfaced in the session page's
 * Progress card (slot C) across all three states. Contract (see #1222 §6):
 *   - Metric is **fillers per minute**, never a raw count (a longer session must not look worse).
 *   - **Session 1 sets the baseline** and shows NO delta ("BASELINE SET").
 *   - **Session 2+** report a signed **percentage** change vs. the baseline rate.
 *   - Lower fillers/min is better, so an improvement is "N% fewer fillers"; a regression is "N% more".
 *   - Sessions under 30s do NOT enter the trend or produce a comparison ("too short to compare").
 *   - The trend shows up to the last 6 sessions with the **baseline pinned as the leftmost column**.
 *
 * This module is presentation-agnostic: it returns the numbers + direction; wording/colour live in the
 * component. It never fabricates a positive — a regression is reported honestly.
 */

// #1265 — single source of truth: the comparability floor is defined ONCE in aggregateProgress and
// re-exported here so every Progress surface shares the identical value (no drift).
export { MIN_COMPARABLE_SECONDS } from './aggregateProgress';
import { MIN_COMPARABLE_SECONDS } from './aggregateProgress';

/** One prior/eligible session's raw inputs (oldest-first ordering is the caller's responsibility). */
export interface SessionRateInput {
    /** Number of filler words detected in the session. */
    fillerCount: number;
    /** Spoken duration in seconds. */
    durationSeconds: number;
}

export type ProgressDirection = 'improved' | 'regressed' | 'flat';

export interface ProgressVsBaselineResult {
    /** True when this is the first eligible session — it defines the baseline, no delta shown. */
    isBaseline: boolean;
    /** True when the CURRENT session is under the comparable-duration floor. */
    tooShort: boolean;
    /** Current session fillers/min (rounded to 1dp), or null when too short. */
    currentRate: number | null;
    /** Baseline (session 1) fillers/min (rounded to 1dp), or null when no baseline exists yet. */
    baselineRate: number | null;
    /**
     * Signed percentage vs. baseline where POSITIVE = improvement (fewer fillers).
     * e.g. +29 means "29% fewer fillers than baseline"; -10 means "10% more". Null when not comparable.
     */
    deltaPercent: number | null;
    direction: ProgressDirection;
    /**
     * Up to 6 fillers/min values for the trend, baseline pinned as the leftmost element, then the most
     * recent comparable sessions. Values are rounded to 1dp.
     */
    trend: number[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

const ratePerMinute = (s: SessionRateInput): number => {
    if (s.durationSeconds <= 0) return 0;
    return (s.fillerCount / s.durationSeconds) * 60;
};

const isComparable = (s: SessionRateInput): boolean => s.durationSeconds >= MIN_COMPARABLE_SECONDS;

/**
 * @param sessionsOldestFirst All of the user's sessions, OLDEST first. The last element is the current
 *   (just-finished, or in-progress "so far") session. Callers pass fillers/min inputs; this owns the math.
 */
export function computeProgressVsBaseline(sessionsOldestFirst: SessionRateInput[]): ProgressVsBaselineResult {
    const empty: ProgressVsBaselineResult = {
        isBaseline: false, tooShort: false, currentRate: null, baselineRate: null,
        deltaPercent: null, direction: 'flat', trend: [],
    };
    if (sessionsOldestFirst.length === 0) return empty;

    const current = sessionsOldestFirst[sessionsOldestFirst.length - 1];
    const currentRate = round1(ratePerMinute(current));

    // Comparable prior sessions (>= floor), excluding the current one, oldest-first.
    const priorComparable = sessionsOldestFirst.slice(0, -1).filter(isComparable);

    // The current session is under the floor: no comparison, no trend entry.
    if (!isComparable(current)) {
        return { ...empty, tooShort: true, currentRate: null,
            baselineRate: priorComparable.length ? round1(ratePerMinute(priorComparable[0])) : null };
    }

    // First eligible session → it IS the baseline; no delta.
    if (priorComparable.length === 0) {
        return { ...empty, isBaseline: true, currentRate, baselineRate: currentRate, trend: [currentRate] };
    }

    const baselineRate = round1(ratePerMinute(priorComparable[0]));
    // Positive = fewer fillers than baseline = improvement.
    const deltaPercent = baselineRate === 0
        ? 0
        : round1(((baselineRate - currentRate) / baselineRate) * 100);
    const direction: ProgressDirection = deltaPercent > 0 ? 'improved' : deltaPercent < 0 ? 'regressed' : 'flat';

    // Trend: baseline pinned leftmost, then the most recent comparable sessions (incl. current), max 6.
    const comparableAll = sessionsOldestFirst.filter(isComparable).map((s) => round1(ratePerMinute(s)));
    const baselineVal = comparableAll[0];
    const rest = comparableAll.slice(1);
    const tail = rest.slice(Math.max(0, rest.length - 5)); // up to 5 most-recent after the baseline
    const trend = [baselineVal, ...tail];

    return { isBaseline: false, tooShort: false, currentRate, baselineRate, deltaPercent, direction, trend };
}
