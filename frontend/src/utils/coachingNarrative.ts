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
    // Slow is a coaching nudge, not a failure — amber, not red. Red is reserved for the genuinely
    // disruptive states (Fast, High fillers, Choppy). Slow still surfaces as a driver via the
    // off-then-watch priority in getTryThisNext.
    if (wpm < ANALYTICS_THRESHOLDS.TARGET_WPM_MIN) return { label: 'Slow', tone: 'watch' };
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
            : 'Pick up the pace on familiar points.';

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

    // Single pass: the first 'off' wins outright; otherwise the first 'watch'.
    let worst: (typeof candidates)[number] | undefined;
    for (const c of candidates) {
        if (c.metric.tone === 'off') { worst = c; break; }
        if (!worst && c.metric.tone === 'watch') worst = c;
    }

    if (!worst) {
        return { driver: null, action: 'Keep the pace steady and land the takeaway.' };
    }
    return { driver: worst.driver, action: worst.action };
};

export interface NarrativeSummary {
    /** The single next action to try (the dominant line). */
    action: string;
    /** Raw strongest driver, e.g. 'pace'; null when everything is on target. */
    driver: string | null;
    /** Driver shown as "Speaking Pace — Slow"; null when on target. */
    driverDisplay: string | null;
    /** Connecting sentence: which signals are steady vs. the one to adjust. */
    why: string;
}

// Driver → the metric's user-facing card name.
const DRIVER_DISPLAY_NAME: Record<string, string> = {
    'pace': 'Speaking Pace',
    'pause rhythm': 'Pause Rhythm',
    'filler words': 'Filler Words',
    'clear delivery': 'Clear Delivery',
};

const joinNatural = (items: string[]): string => {
    if (items.length <= 1) return items[0] ?? '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

/**
 * Narrative-first summary: action first, reason second. Leads with the single "Try this next"
 * action, names the main driver ("Speaking Pace — Slow"), and adds one connecting sentence so the
 * four tools read as a story (driver to adjust + which signals are already steady) rather than a
 * wall of numbers.
 */
export const getNarrativeSummary = (stats: DeliveryAggregates): NarrativeSummary => {
    const next = getTryThisNext(stats);
    const ordered = [
        { driver: 'pace', metric: decodePace(stats.avgWpm) },
        { driver: 'pause rhythm', metric: decodePauseRhythm(stats.avgPausesPerMin) },
        { driver: 'filler words', metric: decodeFillers(stats.avgFillerWordsPerMin) },
        { driver: 'clear delivery', metric: decodeClarity(stats.avgClarity) },
    ];

    if (next.driver === null) {
        return { action: next.action, driver: null, driverDisplay: null, why: 'Every signal is on target — keep it up.' };
    }

    const driverMetric = ordered.find(x => x.driver === next.driver)?.metric;
    const driverDisplay = `${DRIVER_DISPLAY_NAME[next.driver]} — ${driverMetric?.label ?? ''}`;
    const steady = ordered
        .filter(x => x.driver !== next.driver && x.metric.tone === 'good')
        .map(x => DRIVER_DISPLAY_NAME[x.driver].toLowerCase());
    const why = steady.length > 0
        ? `Your ${joinNatural(steady)} ${steady.length === 1 ? 'is' : 'are'} steady; ${next.driver} is the main adjustment.`
        : `${DRIVER_DISPLAY_NAME[next.driver]} is the main thing to adjust right now.`;

    return { action: next.action, driver: next.driver, driverDisplay, why };
};
