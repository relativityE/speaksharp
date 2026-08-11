import type { PracticeSession } from '@/types/session';
import { validatedFillerTotal, getSessionAnalysisMetrics } from './sessionAnalysis';
import { hasValidPauseEvidence } from './metricValidity';

/**
 * #1206 — aggregate cross-session progress. The session-over-session progress % is a COMPOSITE of several
 * delivery signals, not a single metric: aggregating levels out the per-signal variance so the headline is
 * stable. The number is BACKGROUND (see PROGRESS_AND_NEXT_ACTION.md §2); the two takeaways are the product.
 *
 * Model (PO 2026-08-09):
 *  - Each signal is mapped to a 0..1 **quality** (higher = better), which folds in its direction and, for
 *    band signals (pace, pause), its ideal range — so "faster WPM" is not blindly "better".
 *  - Session 1 = the starting reference (no previous session to compare against); no delta.
 *  - Session N: for each signal with valid evidence in BOTH N and the PREVIOUS comparable session, the signed
 *    % change vs the previous session's quality; the session **aggregate** = the MEAN of those per-signal %s
 *    (equal weight, v1).
 *  - A signal missing evidence in either session is left out; a previous-session quality of 0 is skipped (no /0).
 *
 * v1 signals: filler rate, clarity, pace/WPM, pause rhythm. All thresholds are MVP and tunable (#1206).
 */

/** Minimum spoken duration for a session to count toward comparison/trend. */
export const MIN_COMPARABLE_SECONDS = 30;

// ── MVP tunables (adjust from feedback; #1206) ──────────────────────────────────────────────────────
export const FILLER_RATE_ZERO_QUALITY = 10; // fillers/min at/above which the filler signal scores 0
export const PACE_IDEAL: [number, number] = [120, 160]; // wpm ideal band
export const PACE_TOLERANCE = 60; // wpm outside the band to reach quality 0
export const SILENCE_IDEAL: [number, number] = [5, 20]; // % of session that is silence — healthy band
export const SILENCE_TOLERANCE = 20; // percentage points outside the band to reach quality 0

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Quality (0..1) for a "lower is better" rate, linear to 0 at `zeroAt`. */
const qualityLowerBetter = (value: number, zeroAt: number): number => clamp01(1 - value / zeroAt);

/** Quality (0..1) for a value that should sit inside `[lo,hi]`, linear falloff over `tol` outside it. */
const qualityInBand = (value: number, [lo, hi]: [number, number], tol: number): number => {
    const dist = Math.max(0, lo - value, value - hi);
    return clamp01(1 - dist / tol);
};

/** One session's per-signal quality inputs. `null` = no valid evidence for that signal (excluded). */
export interface SessionSignals {
    durationSeconds: number;
    fillerRate: number | null; // fillers/min
    clarity: number | null;    // 0..100
    wpm: number | null;
    silencePct: number | null; // 0..100 (pause rhythm proxy)
}

export type ProgressDirection = 'improved' | 'regressed' | 'flat';

export interface AggregateComponent {
    key: 'filler' | 'clarity' | 'pace' | 'pause';
    /** Signed % change of this signal's quality vs the previous session; null when not comparable this session. */
    deltaPercent: number | null;
}

export interface AggregateProgressResult {
    isBaseline: boolean;
    tooShort: boolean;
    /** Signed aggregate % vs the previous session (+ = better); null on first session / too-short / nothing comparable. */
    aggregatePercent: number | null;
    direction: ProgressDirection;
    /** Composite quality (0..100) of the PREVIOUS comparable session — the reference the delta is measured against. */
    baselineQuality: number | null;
    /** Composite quality (0..100) of the current session. */
    currentQuality: number | null;
    components: AggregateComponent[];
    /** Composite quality (0..100) per comparable session, oldest pinned leftmost, capped at 6. */
    trend: number[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Per-signal qualities (0..1) for a session; entries are null where evidence is missing. */
function qualities(s: SessionSignals): Record<AggregateComponent['key'], number | null> {
    return {
        filler: s.fillerRate == null ? null : qualityLowerBetter(s.fillerRate, FILLER_RATE_ZERO_QUALITY),
        clarity: s.clarity == null ? null : clamp01(s.clarity / 100),
        pace: s.wpm == null ? null : qualityInBand(s.wpm, PACE_IDEAL, PACE_TOLERANCE),
        pause: s.silencePct == null ? null : qualityInBand(s.silencePct, SILENCE_IDEAL, SILENCE_TOLERANCE),
    };
}

/** Mean of the non-null signal qualities (0..1), or null when a session carries no valid signal at all. */
function compositeQuality(s: SessionSignals): number | null {
    const vals = Object.values(qualities(s)).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

const KEYS: AggregateComponent['key'][] = ['filler', 'clarity', 'pace', 'pause'];

/**
 * @param sessionsOldestFirst all sessions OLDEST-first; the last element is the current session.
 */
export function computeAggregateProgress(sessionsOldestFirst: SessionSignals[]): AggregateProgressResult {
    const empty: AggregateProgressResult = {
        isBaseline: false, tooShort: false, aggregatePercent: null, direction: 'flat',
        baselineQuality: null, currentQuality: null,
        components: KEYS.map((key) => ({ key, deltaPercent: null })), trend: [],
    };
    if (sessionsOldestFirst.length === 0) return empty;

    const comparable = (s: SessionSignals) =>
        s.durationSeconds >= MIN_COMPARABLE_SECONDS && compositeQuality(s) != null;

    const current = sessionsOldestFirst[sessionsOldestFirst.length - 1];
    const priorComparable = sessionsOldestFirst.slice(0, -1).filter(comparable);
    const qOf = (s: SessionSignals) => Math.round((compositeQuality(s) ?? 0) * 1000) / 10; // 0..100, 1dp

    if (!comparable(current)) {
        return { ...empty, tooShort: true,
            baselineQuality: priorComparable.length ? qOf(priorComparable[priorComparable.length - 1]) : null };
    }

    if (priorComparable.length === 0) {
        // First comparable session — no previous session to compare against, so it is the starting
        // reference only; no delta.
        return { ...empty, isBaseline: true, baselineQuality: qOf(current), currentQuality: qOf(current), trend: [qOf(current)] };
    }

    // Compare against the PREVIOUS comparable session (the one immediately before the current one), not the
    // first session. The first session remains the starting reference; every session after it is measured
    // against the session before it.
    const previous = priorComparable[priorComparable.length - 1];
    const baseQ = qualities(previous);
    const curQ = qualities(current);

    // Per-signal % change of quality vs the previous session; included only when both sides have evidence and base>0.
    const components: AggregateComponent[] = KEYS.map((key) => {
        const b = baseQ[key];
        const c = curQ[key];
        const deltaPercent = b != null && c != null && b > 0 ? round1(((c - b) / b) * 100) : null;
        return { key, deltaPercent };
    });

    const usable = components.map((c) => c.deltaPercent).filter((v): v is number => v != null);
    const aggregatePercent = usable.length ? round1(usable.reduce((a, b) => a + b, 0) / usable.length) : null;
    const direction: ProgressDirection =
        aggregatePercent == null ? 'flat' : aggregatePercent > 0 ? 'improved' : aggregatePercent < 0 ? 'regressed' : 'flat';

    const comparableAll = sessionsOldestFirst.filter(comparable);
    const trendVals = comparableAll.map(qOf);
    const trend = [trendVals[0], ...trendVals.slice(1).slice(-5)];

    return {
        isBaseline: false, tooShort: false, aggregatePercent, direction,
        baselineQuality: qOf(previous), currentQuality: qOf(current), components, trend,
    };
}

/** Extract the v1 signal set from a persisted session, honouring existing provenance gates (never fabricate). */
export function signalsFromSession(s: PracticeSession): SessionSignals {
    const duration = s.duration || 0;
    const fillerTotal = validatedFillerTotal(s.filler_words);
    const m = getSessionAnalysisMetrics(s);
    const pauseOk = hasValidPauseEvidence(s.pause_metrics);
    return {
        durationSeconds: duration,
        fillerRate: fillerTotal != null && duration > 0 ? (fillerTotal / duration) * 60 : null,
        clarity: m.isClarityScorable && typeof s.clarity_score === 'number' ? s.clarity_score : null,
        wpm: typeof s.wpm === 'number' && s.wpm > 0 ? s.wpm : (m.wordCount > 0 && duration > 0 ? (m.wordCount / duration) * 60 : null),
        silencePct: pauseOk ? (s.pause_metrics?.silencePercentage ?? null) : null,
    };
}
