/**
 * #1259 F13 — a zero that cannot be verified is not a zero.
 *
 * Production shows the product's own claim: `session_saved` carried `filler_count: 0` against 82 and
 * 88 spoken words, with clarity 89 and 90. The PO spoke fillers deliberately. So the counter was not
 * broken — it counted what it was given, and what it was given had no fillers in it.
 *
 * THE TRAP THIS EXISTS TO AVOID. `measureFillerDivergence` already computes two counts — the LIVE
 * counter and a deterministic RECOUNT — and reports whether they agree. Wiring that up looks like the
 * whole job. It is not: both read the SAME transcript. If the engine removed disfluencies before
 * either ran, both return zero, they agree perfectly, and the agreement reads as confirmation. That
 * is precisely how "100% clear" was produced, and a divergence check alone would have blessed it.
 *
 * So the honest signal is not "do the counters agree" but "could this transcript evidence a filler at
 * all". A transcript containing zero filler tokens cannot distinguish a fluent speaker from a stripped
 * transcript, and saying so is the difference between a measurement and a flattering guess.
 *
 * That is what `completeness` records:
 *
 *   complete     — fillers were found; the count means what it says.
 *   unobservable — words were transcribed and NOT ONE filler token is present. Zero is unverifiable
 *                  from this transcript, whatever the counters agree on.
 *   no_speech    — nothing was transcribed; there is nothing to measure.
 *
 * Also worth recording: the existing divergence block is gated behind `isShadowMetricsEngineEnabled()`,
 * so in Production it may not run at all. This emission is deliberately NOT behind that flag — a
 * measurement that only exists when a diagnostic flag is on is not available when it is needed.
 *
 * No transcript text, no filler words, no per-word data.
 */
import { safeEmit } from './safeEmit';

export type FillerCompleteness = 'complete' | 'unobservable' | 'no_speech';

export interface FillerMeasurementInput {
    candidateId: string | null;
    /** Words in the transcript the detector actually scored. */
    detectorInputWords: number;
    /** Fillers the deterministic recount found in that same transcript. */
    detectorInputFillers: number;
    /** What the product REPORTED to the user and to `session_saved`. */
    reportedFillers: number | null;
    clarityScore: number | null;
    durationSeconds: number | null;
}

export function resolveCompleteness(words: number, fillersInTranscript: number): FillerCompleteness {
    if (words === 0) return 'no_speech';
    // Not "the counters disagree" — "this transcript cannot evidence a filler either way".
    if (fillersInTranscript === 0) return 'unobservable';
    return 'complete';
}

export function emitFillerMeasurement(input: FillerMeasurementInput): void {
    const completeness = resolveCompleteness(input.detectorInputWords, input.detectorInputFillers);
    safeEmit('filler_measurement', {
        candidate_id_observed: input.candidateId,
        detector_input_words: input.detectorInputWords,
        detector_input_fillers: input.detectorInputFillers,
        reported_fillers: input.reportedFillers,
        clarity_score: input.clarityScore,
        duration_seconds: input.durationSeconds,
        completeness,
        // Only populated when the measurement is NOT complete, so a reason never dresses up a real one.
        unavailable_reason: completeness === 'unobservable'
            ? 'no_filler_tokens_in_transcript'
            : completeness === 'no_speech' ? 'no_transcribed_speech' : null,
    }, 'HIGH');
}
