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
 *
 * PROVISIONAL `clarity_v1` product policy — provisionally approved by the Product Owner (2026-07-31),
 * to be revised on real-user evidence. Not a proven fact.
 */
export const MEANINGFUL_MOVEMENT_POINTS = 3;

/**
 * PROVISIONAL `clarity_v1` action-selection thresholds and targets — provisionally approved
 * (2026-07-31), to be revised on real-user evidence. These are product policy, not proven facts.
 */
export const PROVISIONAL_ACTION_POLICY = {
    fillerTriggerPercent: 5,
    fillerTargetPercent: 3,
    paceFastTriggerWpm: 170,
    paceSlowTriggerWpm: 90,
    paceTargetWpm: 150,
    paceSlowTargetWpm: 130,
} as const;

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
    // FAIL CLOSED: a baseline that is null, ineligible, or carries no clarity is not a comparison —
    // never compare against it. (`baseline.eligible` was previously unchecked, so an ineligible baseline
    // could slip through.)
    if (!baseline || !baseline.eligible || baseline.clarityRaw === null) {
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
export function buildTakeaways(
    current: ProgressEvaluation,
    previous: ProgressEvaluation | null,
    opts: { meaningfulPoints?: number } = {},
): Takeaways {
    const fillerRate = current.wordCount > 0 && current.fillerCount !== null
        ? (current.fillerCount / current.wordCount) * 100
        : null;

    // ── Action selection (PROVISIONAL clarity_v1 policy). Action copy is aligned to the target it
    //    carries, so the words and the structured target can never disagree. ──
    const P = PROVISIONAL_ACTION_POLICY;
    let target: StructuredTarget;
    let practiceThisNext: string;
    if (fillerRate !== null && fillerRate >= P.fillerTriggerPercent) {
        target = { metric: 'filler_rate', direction: 'decrease', targetValue: P.fillerTargetPercent, units: 'percent of words' };
        practiceThisNext = `Cut filler words toward ${P.fillerTargetPercent}%`;
    } else if (current.wpm !== null && current.wpm > P.paceFastTriggerWpm) {
        target = { metric: 'pace', direction: 'decrease', targetValue: P.paceTargetWpm, units: 'words per minute' };
        practiceThisNext = `Slow toward ${P.paceTargetWpm} words per minute`;
    } else if (current.wpm !== null && current.wpm > 0 && current.wpm < P.paceSlowTriggerWpm) {
        target = { metric: 'pace', direction: 'increase', targetValue: P.paceSlowTargetWpm, units: 'words per minute' };
        practiceThisNext = `Lift pace toward ${P.paceSlowTargetWpm} words per minute`;
    } else {
        target = { metric: 'clear_delivery', direction: 'maintain', targetValue: current.clarityRaw ?? 0, units: 'points' };
        practiceThisNext = 'Hold this clear delivery next time';
    }

    // ── Observation: a genuine positive when one exists, otherwise a NEUTRAL MEASURED fact. The fallback
    //    must never be participation/completion-based — §7c "completion is not performance". ──
    let whatWorked: string;
    // "Clearer than your last session" is a COMPARISON claim, so it must clear the SAME two gates the
    // direction statement does: the previous session must be eligible and in the SAME cohort, and the
    // gain must reach the meaningful-movement threshold (§6). A sub-threshold or cross-cohort tick is not
    // a claimable improvement — otherwise takeaways and direction could disagree.
    const improvedVsPrevious =
        previous != null && previous.eligible
        && previous.clarityRaw != null && current.clarityRaw != null
        && previous.cohortKey === current.cohortKey
        && (current.clarityRaw - previous.clarityRaw) >= (opts.meaningfulPoints ?? MEANINGFUL_MOVEMENT_POINTS);

    if (improvedVsPrevious) {
        whatWorked = 'Clearer than your last session';
    } else if (fillerRate !== null && fillerRate < P.fillerTargetPercent) {
        whatWorked = 'Very few filler words';
    } else if (current.wpm !== null && current.wpm >= 130 && current.wpm <= 150) {
        whatWorked = 'Pace stayed in range';
    } else {
        // No valid positive: a neutral MEASURED observation — a fact about this session's delivery, not
        // praise, not improvement, and never "you finished / you showed up".
        whatWorked = current.fillerCount !== null
            ? `${current.fillerCount} filler words this session`
            : 'Pace measured this session';
    }

    return { whatWorked, practiceThisNext, target };
}

/** §7 word limits — enforced, not merely documented. */
export function takeawaysWithinLimits(t: Takeaways): boolean {
    return wordCount(t.whatWorked) <= 6 && wordCount(t.practiceThisNext) <= 8;
}
