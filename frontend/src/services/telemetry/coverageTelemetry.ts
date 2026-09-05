/**
 * #1259 F06 / F14 / F18 — why a point was judged not covered.
 *
 * THE FINDING IS A CONTRADICTION, and only one half of it is currently observable. The PO spoke to
 * their points; the panel reported 1 of 4. `session_saved` records no coverage at all, so the product's
 * verdict and the transcript that contradicts it have never been in the same place.
 *
 * The evaluator is a per-segment keyword-ratio matcher: it extracts keywords from the point's label,
 * finds the single best segment, and compares hits/keywords against two thresholds. That means a
 * verdict of "missing" has several very different causes, which today are indistinguishable:
 *
 *   - no keywords could be extracted at all (a point of only stopwords can never match, ratio 0);
 *   - keywords matched, but below the partial threshold;
 *   - the point was genuinely discussed, in words the matcher does not recognise, or spread across
 *     segment boundaries so no SINGLE segment carries enough of it.
 *
 * Recording the ratio beside the thresholds and the keyword count separates them. A ratio of 0.5
 * against a 0.7 threshold is a threshold question; a keyword count of 0 is a point that never had a
 * chance; a high ratio marked missing would be a defect in the latch.
 *
 * NOTHING HERE CARRIES TEXT. Not the point label, not the topic, not the matched quote — the evaluator
 * returns an evidence quote and it is deliberately not accepted by this module. Points are identified
 * by POSITION only.
 */
import { safeEmit } from './safeEmit';

/** Bumped when the matcher's behaviour changes, so verdicts stay comparable across releases. */
export const EVALUATOR_VERSION = 'keyword-ratio-v1';

export interface CoveragePointObservation {
    /** Anonymous position within the brief. Never the label. */
    position: number;
    matchRatio: number;
    keywordCount: number;
    verdict: string;
    /** Whether the cover came from the latch rather than from THIS evaluation. */
    latched: boolean;
}

export interface CoverageEvaluationInput {
    pointsSupplied: number;
    pointsEvaluated: number;
    coveredThreshold: number;
    partialThreshold: number;
    transcriptWordCount: number;
    observations: readonly CoveragePointObservation[];
}

/**
 * The evaluator runs on render, so this would otherwise emit on every frame of a live session. Only a
 * CHANGED result is reported — the same de-duplication the transcript stages use, and for the same
 * reason: a per-render stream is the noise the contract forbids, while a changed verdict is the event.
 */
let lastSignature = '';

export function emitCoverageEvaluation(input: CoverageEvaluationInput): void {
    if (input.pointsEvaluated === 0) return;   // no brief, nothing to judge

    const covered = input.observations.filter((o) => o.verdict === 'covered').length;
    const partial = input.observations.filter((o) => o.verdict === 'partial').length;

    const base = {
        evaluator_version: EVALUATOR_VERSION,
        points_supplied: input.pointsSupplied,
        points_evaluated: input.pointsEvaluated,
        covered_threshold: input.coveredThreshold,
        partial_threshold: input.partialThreshold,
        covered_count: covered,
        partial_count: partial,
        // F14 — what a "Retry these N points" label should say. Recorded so the number the user is
        // shown can be compared against the number the evaluator actually produced.
        retry_target_count: input.pointsEvaluated - covered,
        transcript_word_count: input.transcriptWordCount,
    };

    const signature = JSON.stringify([base, input.observations]);
    if (signature === lastSignature) return;
    lastSignature = signature;

    safeEmit('coverage_evaluation', base, 'HIGH');

    for (const o of input.observations) {
        safeEmit('coverage_point', {
            evaluator_version: EVALUATOR_VERSION,
            point_position: o.position,
            match_ratio: Number(o.matchRatio.toFixed(3)),
            // Zero keywords means the point could NEVER match, whatever was said. That is a different
            // failure from "said it differently", and the two look identical in the verdict alone.
            keyword_count: o.keywordCount,
            verdict: o.verdict,
            latched: o.latched,
        }, 'LOW');
    }
}

/** Test seam, and the boundary between one brief's evaluation and the next. */
export function __resetCoverageTelemetryForTests(): void { lastSignature = ''; }
