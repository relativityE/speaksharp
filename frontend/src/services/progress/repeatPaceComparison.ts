import type { ExclusionReason } from './buildProgressEvaluation';

/**
 * Open Mic practice loop: compare an original take and its linked repeat on PACE, or say plainly why they cannot be
 * compared. Pace is the first repeat metric because it is the one the app measures reliably through real speakers
 * (median pace error 6.7% on clean audio, 11.8% through computer speakers; coachable fillers were counted 27/66).
 *
 * Pure: no I/O, no React. Inputs are the persisted progress evaluation of each take plus the session's product marker.
 *
 * Rules, checked in this order (the first failing rule is the one reason shown):
 *   1. both takes are Open Mic                         -> otherwise `not_open_mic` (the page shows nothing for it);
 *   2. both evaluations are eligible                   -> otherwise `not_eligible` with the first stored reason;
 *   3. same recording setup (engine x version x model) -> otherwise `different_setup`;
 *   4. both takes have a measured pace                 -> otherwise `no_pace`;
 *   5. lengths within 0.5x-2x of each other            -> otherwise `different_length`.
 *
 * Not checkable: whether both takes used the same prompt. Open Mic stores no prompt identity, so no rule pretends to.
 *
 * A change smaller than PACE_NORMAL_VARIATION_PERCENT is reported as normal take-to-take variation, never as a change.
 * PROVISIONAL: 10% is set from the speaker measurement above. Repeat-to-repeat variation by real speakers is not yet
 * measured; retune this constant when it is.
 */
export const PACE_NORMAL_VARIATION_PERCENT = 10;
export const PACE_LENGTH_RATIO = { MIN: 0.5, MAX: 2 } as const;

export interface PaceTake {
    product: string | null;
    eligible: boolean;
    exclusionReasons: readonly string[];
    durationSeconds: number | null;
    wpm: number | null;
    cohortKey: string | null;
}

export type PaceCantCompareReason = 'not_open_mic' | 'not_eligible' | 'different_setup' | 'no_pace' | 'different_length';

export type RepeatPaceComparison =
    | {
        status: 'compared';
        beforeWpm: number;
        afterWpm: number;
        /** (after - before) / before x 100. */
        changePercent: number;
        band: 'within_normal_variation' | 'changed';
    }
    | { status: 'cant_compare'; reason: PaceCantCompareReason; exclusionReason?: ExclusionReason }
    /** A read failed or a take's rows are missing: nothing is said about pace. */
    | { status: 'unavailable' };

const EXCLUSION_REASONS: readonly ExclusionReason[] = [
    'not_completed', 'too_short', 'too_few_words', 'no_transcript', 'no_clarity_evidence', 'unverified_attribution',
    'engine_not_comparable', 'unknown',
];

const positive = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

function firstExclusion(take: PaceTake): ExclusionReason {
    const found = take.exclusionReasons.find((reason) => (EXCLUSION_REASONS as readonly string[]).includes(reason));
    return (found as ExclusionReason | undefined) ?? 'unknown';
}

export function comparePace(original: PaceTake | null, repeat: PaceTake | null): RepeatPaceComparison {
    if (!original || !repeat) return { status: 'unavailable' };
    if (original.product !== 'open_mic' || repeat.product !== 'open_mic') return { status: 'cant_compare', reason: 'not_open_mic' };
    for (const take of [original, repeat]) {
        if (!take.eligible) {
            const exclusionReason = firstExclusion(take);
            return exclusionReason === 'engine_not_comparable'
                ? { status: 'cant_compare', reason: 'different_setup' }
                : { status: 'cant_compare', reason: 'not_eligible', exclusionReason };
        }
    }
    if (!original.cohortKey || original.cohortKey !== repeat.cohortKey) return { status: 'cant_compare', reason: 'different_setup' };
    if (!positive(original.wpm) || !positive(repeat.wpm)) return { status: 'cant_compare', reason: 'no_pace' };
    if (!positive(original.durationSeconds) || !positive(repeat.durationSeconds)) return { status: 'cant_compare', reason: 'different_length' };
    const ratio = repeat.durationSeconds / original.durationSeconds;
    if (ratio < PACE_LENGTH_RATIO.MIN || ratio > PACE_LENGTH_RATIO.MAX) return { status: 'cant_compare', reason: 'different_length' };
    const changePercent = ((repeat.wpm - original.wpm) / original.wpm) * 100;
    return {
        status: 'compared',
        beforeWpm: original.wpm,
        afterWpm: repeat.wpm,
        changePercent,
        band: Math.abs(changePercent) < PACE_NORMAL_VARIATION_PERCENT ? 'within_normal_variation' : 'changed',
    };
}
