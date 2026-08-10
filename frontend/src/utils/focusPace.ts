/**
 * #1046 G6/G7 — Focus Points pace math (spec §2, "Coverage & pace").
 *
 * PURE + single-run. The dial the user turns is the running average **per point** (`elapsed / points
 * covered`); the consequence is the projected total (`average × total points`). Comparing the average to
 * the guide is arithmetically identical to comparing the projection to the guide total, so we compute both
 * from one number.
 *
 * Hard rules encoded here (see the spec's global invariants):
 *   - **Remaining time is NEVER produced.** We expose the guide total, the projection, and the per-point
 *     average — durations the run is heading toward, never a countdown.
 *   - Before the first point is covered there is NO average → `pacePerPointSec` is null (render `— /point`,
 *     no bar, no projection). Never divide by zero into Infinity.
 *   - With no guide there is nothing to project against → guide/projection/bar are all null (count only).
 */

export interface PaceInputs {
    /** Elapsed seconds while recording (during) or the final duration (after). */
    elapsedSec: number;
    /** Points covered so far (the denominator of the running average). */
    coveredCount: number;
    /** Total declared points. */
    totalPoints: number;
    /** The user's guide, seconds per point; null when the guide was skipped. */
    guideSecPerPoint: number | null;
}

export interface PaceStats {
    /** Running average sec/point = elapsed / coveredCount; null before the first point is covered. */
    pacePerPointSec: number | null;
    /** Guide total = guideSecPerPoint × totalPoints; null when no guide. */
    guideTotalSec: number | null;
    /** Projection = average × totalPoints; null when no average OR no guide (nothing to project against). */
    projectionSec: number | null;
    /** average > guide (strictly). false when either is absent. Drives the amber tint + the nudge. */
    overGuide: boolean;
    /** Pace-bar fill = average/guide clamped to [0,1]; null when no guide or no average. */
    barFraction: number | null;
}

/** ~10% tolerance: within it, pace reads as on-track (silent nudge, neutral colour). */
const OVER_GUIDE_TOLERANCE = 1.1;

export function computePaceStats({ elapsedSec, coveredCount, totalPoints, guideSecPerPoint }: PaceInputs): PaceStats {
    const hasGuide = typeof guideSecPerPoint === 'number' && guideSecPerPoint > 0;
    // No average until at least one point is covered — never elapsed-as-stand-in, never ∞.
    const pacePerPointSec = coveredCount > 0 && elapsedSec > 0 ? elapsedSec / coveredCount : null;
    const guideTotalSec = hasGuide ? guideSecPerPoint! * totalPoints : null;
    const projectionSec = hasGuide && pacePerPointSec != null ? pacePerPointSec * totalPoints : null;
    const overGuide = hasGuide && pacePerPointSec != null ? pacePerPointSec > guideSecPerPoint! : false;
    const barFraction = hasGuide && pacePerPointSec != null
        ? Math.max(0, Math.min(1, pacePerPointSec / guideSecPerPoint!))
        : null;
    return { pacePerPointSec, guideTotalSec, projectionSec, overGuide, barFraction };
}

/** m:ss for a duration. Used for the guide/projection/pace readouts — never a countdown. */
export function fmtDuration(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Is a PACE nudge warranted right now (before timing gates)? Only when a guide is set, the running average
 * is meaningfully over it (beyond the ~10% tolerance), AND at least one point remains. Never once the last
 * point is covered — overrunning then costs the user nothing.
 */
export function paceNudgeWarranted({ elapsedSec, coveredCount, totalPoints, guideSecPerPoint }: PaceInputs): boolean {
    const hasGuide = typeof guideSecPerPoint === 'number' && guideSecPerPoint > 0;
    if (!hasGuide) return false;
    if (coveredCount <= 0) return false;            // no average yet
    if (coveredCount >= totalPoints) return false;  // nothing left to pace toward
    const avg = elapsedSec / coveredCount;
    return avg > guideSecPerPoint! * OVER_GUIDE_TOLERANCE;
}

/**
 * The pace-nudge sentence: name the projection (the consequence), then the next action — never the
 * shortfall. Banned tokens (elapsed counts, "behind", "missed", "untouched", "running out") never appear.
 * Example: "At this pace you'd run a little past 3 min. Point 3 whenever you're ready."
 */
export function paceNudgeMessage(guideTotalSec: number, nextPointNumber: number): string {
    const guideMin = Math.max(1, Math.round(guideTotalSec / 60));
    return `At this pace you'd run a little past ${guideMin} min. Point ${nextPointNumber} whenever you're ready.`;
}
