/**
 * Coaching narrative — "numbers support coaching, they are not the coaching."
 *
 * Decodes the analytics aggregates into the plain user-facing vocabulary the Sound Confident focus
 * uses, so the dashboard can lead with a label (and one "Try this next" action) and keep the raw
 * number secondary. Thresholds are grounded in ANALYTICS_THRESHOLDS where one exists; the pause/
 * filler per-minute cutoffs are explicit, documented heuristics that Product can tune in one place.
 */
import { ANALYTICS_THRESHOLDS } from './sessionAnalysis';

/** good = on target, watch = drifting, off = needs attention. Drives label copy + UI tone. */
export type CoachingTone = 'good' | 'watch' | 'off';
export interface CoachingMetric {
    label: string;
    tone: CoachingTone;
}

// Pause Rhythm cutoffs (pauses/min). CHOPPY mirrors the score's `pausesPerMinute > 12` penalty;
// SPARSE is the "too few pauses / rushing" floor.
export const PAUSE_RHYTHM_CHOPPY_PER_MIN = 12;
export const PAUSE_RHYTHM_SPARSE_PER_MIN = 3;
// Filler cutoffs (fillers/min) — the analytics card is per-minute, so the label tracks that value.
export const FILLER_HIGH_PER_MIN = 6;
export const FILLER_NOTICEABLE_PER_MIN = 3;
// Clear Delivery cutoffs (clarity %, 0–100).
export const CLARITY_STRONG = 80;
export const CLARITY_DEVELOPING = 60;

const num = (value: string | number): number => (typeof value === 'number' ? value : Number(value) || 0);

/** Speaking Pace: Fast / Steady / Slow (Not measured). Grounded in TARGET_WPM_MIN/MAX (130–150). */
export const decodePace = (avgWpm: string | number): CoachingMetric => {
    const wpm = num(avgWpm);
    if (wpm <= 0) return { label: 'Not measured', tone: 'watch' };
    if (wpm > ANALYTICS_THRESHOLDS.TARGET_WPM_MAX) return { label: 'Fast', tone: 'off' };
    if (wpm < ANALYTICS_THRESHOLDS.TARGET_WPM_MIN) return { label: 'Slow', tone: 'off' };
    return { label: 'Steady', tone: 'good' };
};

/** Pause Rhythm: Smooth / Sparse / Choppy. */
export const decodePauseRhythm = (pausesPerMin: string | number): CoachingMetric => {
    const rate = num(pausesPerMin);
    if (rate > PAUSE_RHYTHM_CHOPPY_PER_MIN) return { label: 'Choppy', tone: 'off' };
    if (rate < PAUSE_RHYTHM_SPARSE_PER_MIN) return { label: 'Sparse', tone: 'watch' };
    return { label: 'Smooth', tone: 'good' };
};

/** Filler Words: Low / Noticeable / High. */
export const decodeFillers = (fillersPerMin: string | number): CoachingMetric => {
    const rate = num(fillersPerMin);
    if (rate >= FILLER_HIGH_PER_MIN) return { label: 'High', tone: 'off' };
    if (rate >= FILLER_NOTICEABLE_PER_MIN) return { label: 'Noticeable', tone: 'watch' };
    return { label: 'Low', tone: 'good' };
};

/** Clear Delivery: Strong / Developing / Needs focus. */
export const decodeClarity = (clarityPct: string | number): CoachingMetric => {
    const pct = num(clarityPct);
    if (pct >= CLARITY_STRONG) return { label: 'Strong', tone: 'good' };
    if (pct >= CLARITY_DEVELOPING) return { label: 'Developing', tone: 'watch' };
    return { label: 'Needs focus', tone: 'off' };
};

export interface DeliveryAggregates {
    avgWpm: string | number;
    avgPausesPerMin: string | number;
    avgFillerWordsPerMin: string | number;
    avgClarity: string | number;
}

export interface TryThisNext {
    /** Plain-language driver, e.g. "pace" — null when everything is on target. */
    driver: string | null;
    /** The single next action to try. */
    action: string;
}

/**
 * One "Try this next" recommendation from the strongest weakness. Priority follows the score's
 * delivery weighting (pace > fillers > pauses) then clarity; an `off` metric is always preferred
 * over a merely `watch` one. Action copy mirrors calculateSpeakingScore's actions for consistency.
 */
export const getTryThisNext = (stats: DeliveryAggregates): TryThisNext => {
    const wpm = num(stats.avgWpm);
    const pace = decodePace(stats.avgWpm);
    const pauses = decodePauseRhythm(stats.avgPausesPerMin);
    const fillers = decodeFillers(stats.avgFillerWordsPerMin);
    const clarity = decodeClarity(stats.avgClarity);

    const paceAction = wpm > ANALYTICS_THRESHOLDS.FAST_WPM
        ? 'Give the next key idea a beat of silence.'
        : pace.label === 'Fast'
            ? 'Ease the pace at sentence endings.'
            : 'Add a little more momentum through familiar lines.';

    // Ordered candidates: { metric, driver, action }. First matching the worst tone wins.
    const candidates = [
        { metric: pace, driver: 'pace', action: paceAction },
        { metric: fillers, driver: 'filler words', action: 'When a filler is coming, pause and restart.' },
        {
            metric: pauses,
            driver: 'pause rhythm',
            action: pauses.label === 'Choppy'
                ? 'Finish a full phrase before taking the next pause.'
                : 'Pause once before the takeaway.',
        },
        { metric: clarity, driver: 'clear delivery', action: 'Say the main point before the context.' },
    ];

    const worst = candidates.find(c => c.metric.tone === 'off')
        ?? candidates.find(c => c.metric.tone === 'watch');

    if (!worst) {
        return { driver: null, action: 'Keep the pace steady and land the takeaway.' };
    }
    return { driver: worst.driver, action: worst.action };
};
