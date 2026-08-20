import { paceNudgeWarranted, paceNudgeMessage, type PaceInputs } from './focusPace';

/**
 * #1046 G6/G7 §2 — the live nudge state machine (pure reducer + a thin hook wrapper elsewhere).
 *
 * Discipline the spec makes non-negotiable:
 *   - **Silent by default.** No filler text; `activeText` is null unless a nudge is genuinely warranted.
 *   - **Minimum 8s on screen** before a nudge can clear/replace (unreadable mid-sentence otherwise).
 *   - **Hard cap of two per run.**
 *   - **Never after the last point is covered** (overrunning then costs nothing).
 *   - **Names the next action, never the shortfall** — message text comes from the banned-word-free builders.
 *   - Fires on the pace ratio breaking (guide set); with no guide, a conservative coverage-only fallback.
 *
 * Time base is `elapsedSec` (monotonic recording seconds), NOT wall-clock — deterministic + testable, and
 * it never renders as an elapsed count.
 */

export const NUDGE_MIN_HOLD_SEC = 8;
export const NUDGE_MAX_PER_RUN = 2;
/** No-guide fallback: only "well into the run" — enough time that an untouched point is worth a nudge. */
export const NUDGE_COVERAGE_FALLBACK_MIN_ELAPSED_SEC = 75;

export interface NudgeState {
    shownCount: number;
    activeText: string | null;
    activeSinceSec: number | null;
}

export const initialNudgeState: NudgeState = { shownCount: 0, activeText: null, activeSinceSec: null };

export interface NudgeInputs extends PaceInputs {
    sessionState: 'before' | 'during' | 'after';
    /** 1-based number of the next not-yet-covered point; null when all points are covered. */
    nextPointNumber: number | null;
}

function coverageFallbackWarranted(i: NudgeInputs): boolean {
    const hasGuide = typeof i.guideSecPerPoint === 'number' && i.guideSecPerPoint > 0;
    if (hasGuide) return false; // the pace nudge owns the guided case
    return (
        i.coveredCount < i.totalPoints &&
        i.coveredCount > 0 &&
        i.elapsedSec >= NUDGE_COVERAGE_FALLBACK_MIN_ELAPSED_SEC
    );
}

/** Pure step: given the prior nudge state and the current inputs, return the next nudge state. */
export function advanceNudge(state: NudgeState, inputs: NudgeInputs): NudgeState {
    // Only the during-state carries a nudge; before/after reset it (a fresh run starts with a clean count).
    if (inputs.sessionState !== 'during') return initialNudgeState;

    // Honour the minimum hold: once shown, a nudge stays put for at least 8s.
    const held =
        state.activeText != null &&
        state.activeSinceSec != null &&
        inputs.elapsedSec - state.activeSinceSec < NUDGE_MIN_HOLD_SEC;
    if (held) return state;

    const warranted =
        inputs.nextPointNumber != null &&
        (paceNudgeWarranted(inputs) || coverageFallbackWarranted(inputs));

    // A nudge is currently shown and its hold has elapsed: keep it while still warranted, else clear it.
    if (state.activeText != null) {
        return warranted ? state : { ...state, activeText: null, activeSinceSec: null };
    }

    // Nothing shown: fire a new nudge if warranted and we are under the per-run cap.
    if (warranted && state.shownCount < NUDGE_MAX_PER_RUN) {
        const hasGuide = typeof inputs.guideSecPerPoint === 'number' && inputs.guideSecPerPoint > 0;
        const text = hasGuide
            ? paceNudgeMessage(inputs.guideSecPerPoint! * inputs.totalPoints, inputs.nextPointNumber!)
            : `Good moment to bring in point ${inputs.nextPointNumber}.`;
        return { shownCount: state.shownCount + 1, activeText: text, activeSinceSec: inputs.elapsedSec };
    }

    return state;
}
