/**
 * #1259 F07 — was there a practice loop, or only copy that looks like one?
 *
 * `verdictFromSuggestions` (utils/liveCoaching.ts:95) ALWAYS returns a verdict. With no AI
 * suggestions it substitutes "Session saved — nice work." and a generic fix built from the top filler.
 * The review screen therefore renders something in both cases, and the PO's report — "I did not see
 * the practice loop improvement cycle expected" — describes the fallback, not an empty screen.
 *
 * No artifact we hold can tell those apart: the DOM shows text either way, and no event records
 * whether suggestions existed. Recording the SOURCE of each half is the whole contribution here.
 *
 * NO GENERATED TEXT IS SENT. Only whether each half came from a generator or a fallback.
 */
import { safeEmit } from './safeEmit';
import { currentAttemptId } from './journeyIdentity';

export type ContentSource = 'generated' | 'fallback';
export type SuppressionReason = 'none' | 'no_suggestions' | 'not_in_review_state';

/**
 * #1259 item 5 — the phase this receipt describes.
 *
 * `rendered: boolean` could not separate "never requested" from "requested and failed" from "succeeded
 * and the user never saw it". Those are three different defects with three different owners, and the
 * practice loop is the feature where the difference between them is the whole question.
 */
export type PracticeLoopPhase = 'requested' | 'completed' | 'failed' | 'persisted' | 'rendered';

/** Nothing has been produced yet at this phase, so a count would be a claim rather than a measurement. */
export const COUNT_NOT_APPLICABLE = -1;

export interface PracticeLoopInput {
    phase: PracticeLoopPhase;
    /** How many "What went well" phrases exist. The contract is exactly one; the count proves it. */
    whatWentWellCount?: number;
    /** How many "What to improve" phrases exist. The contract is exactly one; the count proves it. */
    whatToImproveCount?: number;
    suggestionsPresent: boolean;
    whatWentWellSource: ContentSource;
    whatToImproveSource: ContentSource;
    rendered: boolean;
    nextActionPersisted: boolean;
    suppressionReason: SuppressionReason;
}

/**
 * The review screen re-renders freely; only a changed answer is an event — WITHIN ONE ATTEMPT.
 *
 * This was a module-global signature over the payload alone. Two successive reviews with the same
 * generated/fallback and next-action booleans is an ordinary outcome, not a repeat, and the second one
 * was suppressed entirely: no `practice_loop` receipt for that attempt at all. Nothing reset it in
 * production, and the envelope carrying journey and attempt identity is added downstream of this return,
 * so the signature could not tell two takes apart even in principle.
 *
 * Scoping the key to the attempt makes "the same answer again" mean what a reader assumes: the same
 * answer about the SAME recording.
 */
let lastSignature = '';

export function emitPracticeLoop(input: PracticeLoopInput): void {
    const props = {
        phase: input.phase,
        // NUMBERS ONLY. The phrases themselves are coaching text about what someone said, and no phase of
        // this event has ever been allowed to carry them.
        what_went_well_count: input.whatWentWellCount ?? COUNT_NOT_APPLICABLE,
        what_to_improve_count: input.whatToImproveCount ?? COUNT_NOT_APPLICABLE,
        suggestions_present: input.suggestionsPresent,
        what_went_well_source: input.whatWentWellSource,
        what_to_improve_source: input.whatToImproveSource,
        rendered: input.rendered,
        next_action_persisted: input.nextActionPersisted,
        suppression_reason: input.suppressionReason,
    };
    // `currentAttemptId()` is null between takes; that is a real scope too — a review shown with no
    // attempt open is not the same event as one shown during the next recording.
    const signature = JSON.stringify([currentAttemptId(), props]);
    if (signature === lastSignature) return;
    lastSignature = signature;
    safeEmit('practice_loop', props, 'HIGH');
}

export function __resetPracticeLoopTelemetryForTests(): void { lastSignature = ''; }
