/**
 * #1045 PR-C — deterministic Progress presentation.
 *
 * Turns evaluation records (PR-B) into the exact user-facing output `PROGRESS_AND_NEXT_ACTION.md`
 * requires: a neutral direction statement (§6) and EXACTLY TWO takeaways, of which exactly one is an
 * action (§7).
 *
 * Deterministic and pure: no AI generation participates in selection or phrasing (§9), no provider call,
 * no network. The same evaluation always produces the same words.
 *
 * Prohibited by §2 and enforced here by construction: no absolute score, no grade, no ranking, no
 * cross-user comparison, no "overall speaking quality" claim, and no fabricated positive.
 */
import type { ProgressEvaluation } from './buildProgressEvaluation';

/**
 * §6 — the minimum movement that counts as meaningful. This is a PRODUCT POLICY value, not a statistic
 * inferred from observed variance: a calculable difference is not automatically meaningful user
 * progress. Recorded with the formula version so a later change is a new version, never a silent
 * restatement.
 */
export const MEANINGFUL_MOVEMENT_POINTS = 3;

export type ProgressDirection = 'improved' | 'declined' | 'below_policy' | 'baseline' | 'unavailable';

/** Why a comparison could not be made — shown to the user, never a blank or a zero. */
export type UnavailableReason = 'not_eligible' | 'no_comparable_session' | 'new_cohort';

export interface DirectionResult {
    direction: ProgressDirection;
    /** Signed points vs baseline, unrounded. Null when no comparison exists. */
    deltaPoints: number | null;
    /** The sentence shown to the user. Never implies a grade or a ranking. */
    text: string;
    reason: UnavailableReason | null;
}

/** §6 direction, computed from unrounded values and rounded only for display. */
export function describeDirection(
    current: ProgressEvaluation,
    baseline: ProgressEvaluation | null,
    opts: { meaningfulPoints?: number } = {},
): DirectionResult {
    const threshold = opts.meaningfulPoints ?? MEANINGFUL_MOVEMENT_POINTS;

    if (!current.eligible || current.clarityRaw === null) {
        return {
            direction: 'unavailable',
            deltaPoints: null,
            reason: 'not_eligible',
            text: 'Not enough comparable data yet',
        };
    }
    if (!baseline || baseline.clarityRaw === null) {
        return {
            direction: 'baseline',
            deltaPoints: null,
            reason: null,
            text: "Baseline established — we'll compare future eligible sessions with this one.",
        };
    }
    if (baseline.cohortKey !== current.cohortKey) {
        // §4: a cohort change restarts the comparison. Saying so plainly beats a false jump.
        return {
            direction: 'unavailable',
            deltaPoints: null,
            reason: 'new_cohort',
            text: 'Not enough comparable data yet — your setup changed, so the comparison restarted.',
        };
    }

    // Arithmetic on stored unrounded values; rounding happens only for display.
    const delta = current.clarityRaw - baseline.clarityRaw;
    const shown = Math.round(Math.abs(delta));

    if (Math.abs(delta) < threshold) {
        return { direction: 'below_policy', deltaPoints: delta, reason: null, text: 'No meaningful change yet.' };
    }
    const word = shown === 1 ? 'point' : 'points';
    return {
        direction: delta > 0 ? 'improved' : 'declined',
        deltaPoints: delta,
        reason: null,
        text: `Clear delivery moved ${delta > 0 ? 'up' : 'down'} ${shown} ${word}.`,
    };
}

/** A measurable target carried into the next session — names a metric, a direction and a value. */
export interface StructuredTarget {
    metric: 'filler_rate' | 'pace' | 'clear_delivery';
    direction: 'decrease' | 'increase' | 'maintain';
    targetValue: number;
    units: string;
}

export interface Takeaways {
    /** ≤6 words. Observation, never an action. Neutral when there is no valid positive. */
    whatWorked: string;
    /** ≤8 words. THE single action. Canonical label: "Practice this next". */
    practiceThisNext: string;
    target: StructuredTarget;
}

/** The approved user-facing label for the action takeaway. "Try next"/"Try this next" are superseded. */
export const PRACTICE_THIS_NEXT_LABEL = 'Practice this next';

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * §7 — exactly two takeaways, selected deterministically.
 *
 * `whatWorked` prefers a genuine positive; when every measured metric declined or sits outside its
 * healthy band there is NO valid positive, so it falls back to a NEUTRAL factual observation rather than
 * inventing praise or omitting the takeaway (the §7 non-positive fallback).
 */
export function buildTakeaways(current: ProgressEvaluation, previous: ProgressEvaluation | null): Takeaways {
    const fillerRate = current.wordCount > 0 && current.fillerCount !== null
        ? (current.fillerCount / current.wordCount) * 100
        : null;

    // ── Action selection: weighted by actionability, not raw magnitude (§7). ──
    let target: StructuredTarget;
    let practiceThisNext: string;
    if (fillerRate !== null && fillerRate >= 5) {
        target = { metric: 'filler_rate', direction: 'decrease', targetValue: 3, units: 'percent of words' };
        practiceThisNext = 'Pause instead of filling the gap';
    } else if (current.wpm !== null && current.wpm > 170) {
        target = { metric: 'pace', direction: 'decrease', targetValue: 150, units: 'words per minute' };
        practiceThisNext = 'Slow your opening thirty seconds';
    } else if (current.wpm !== null && current.wpm > 0 && current.wpm < 90) {
        target = { metric: 'pace', direction: 'increase', targetValue: 130, units: 'words per minute' };
        practiceThisNext = 'Keep your sentences moving forward';
    } else {
        target = { metric: 'clear_delivery', direction: 'maintain', targetValue: current.clarityRaw ?? 0, units: 'points' };
        practiceThisNext = 'Record one more at this pace';
    }

    // ── Observation: a genuine positive when one exists, otherwise neutral and factual. ──
    let whatWorked: string;
    const improvedVsPrevious = previous?.clarityRaw != null && current.clarityRaw != null
        && current.clarityRaw > previous.clarityRaw;

    if (improvedVsPrevious) {
        whatWorked = 'Clearer than your last session';
    } else if (fillerRate !== null && fillerRate < 3) {
        whatWorked = 'Very few filler words';
    } else if (current.wpm !== null && current.wpm >= 130 && current.wpm <= 150) {
        whatWorked = 'Pace stayed in range';
    } else {
        // No valid positive — a neutral observation, stated without praise or implied improvement.
        whatWorked = 'Full session recorded and saved';
    }

    return { whatWorked, practiceThisNext, target };
}

/** §7 word limits — enforced, not merely documented. */
export function takeawaysWithinLimits(t: Takeaways): boolean {
    return wordCount(t.whatWorked) <= 6 && wordCount(t.practiceThisNext) <= 8;
}
