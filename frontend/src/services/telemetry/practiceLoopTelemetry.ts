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

export type ContentSource = 'generated' | 'fallback';
export type SuppressionReason = 'none' | 'no_suggestions' | 'not_in_review_state';

export interface PracticeLoopInput {
    suggestionsPresent: boolean;
    whatWentWellSource: ContentSource;
    whatToImproveSource: ContentSource;
    rendered: boolean;
    nextActionPersisted: boolean;
    suppressionReason: SuppressionReason;
}

/** The review screen re-renders freely; only a changed answer is an event. */
let lastSignature = '';

export function emitPracticeLoop(input: PracticeLoopInput): void {
    const props = {
        suggestions_present: input.suggestionsPresent,
        what_went_well_source: input.whatWentWellSource,
        what_to_improve_source: input.whatToImproveSource,
        rendered: input.rendered,
        next_action_persisted: input.nextActionPersisted,
        suppression_reason: input.suppressionReason,
    };
    const signature = JSON.stringify(props);
    if (signature === lastSignature) return;
    lastSignature = signature;
    safeEmit('practice_loop', props, 'HIGH');
}

export function __resetPracticeLoopTelemetryForTests(): void { lastSignature = ''; }
