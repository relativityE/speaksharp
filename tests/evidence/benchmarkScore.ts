/**
 * #1304 Task 3B — THE SCORING SEAM.
 *
 * The ONLY path from a live benchmark run to a WER row. The invalid-run guard lives INSIDE this
 * function, so "the guard runs before scoring" is true BY CONSTRUCTION rather than by assertion.
 *
 * WHY THIS REPLACES A SOURCE-ORDERING CHECK. `benchmarkHarnessSurface.test.tsx` asserted the ordering
 * textually — `source.indexOf('no_finalized_saved_transcript') < source.indexOf('wordErrorRate(')`.
 * That is fragile to comments and refactors, and it proves nothing about runtime behaviour: it cannot
 * see whether an artifact or a log was emitted before the guard ran, which was the OTHER half of the
 * defect. Assert ordering only when the two operations CAN be reordered. Here they cannot.
 *
 * Scoring is Track A: transcript accuracy under the official normalization, comparable to published
 * WER. Disfluency belongs to Track B and is a different question with a different normalizer.
 */
import { wordErrorRate, type WerResult } from './werMetric';

/** Why a run produced no row. Every reason is NAMED — absence is never a silent empty score. */
export type BenchmarkInvalidReason =
    | 'transcript_surface_absent'
    | 'transcript_surface_empty'
    | 'no_finalized_saved_transcript'
    | 'unmeasurable_reference';

/** What the harness read from the page. Mirrors `BenchmarkTranscriptRead` without importing Playwright. */
export type TranscriptRead =
    | { ok: true; text: string }
    | { ok: false; invalidReason: 'transcript_surface_absent' | 'transcript_surface_empty' };

export type BenchmarkScore =
    | { ok: true; row: WerResult<'track_a'> }
    | { ok: false; invalidReason: BenchmarkInvalidReason };

/**
 * Score one benchmark run, or refuse to.
 *
 * `saved.selectedForSave` is the FINALIZED transcript the product chose to persist — the authoritative
 * text, not whatever happened to be painted on screen. It is checked FIRST: a run with no finalized
 * transcript is invalid, and an invalid run must leave no number and no artifact behind.
 */
export function scoreBenchmarkRun(
    read: TranscriptRead,
    reference: string,
    saved: { selectedForSave: string | null | undefined },
): BenchmarkScore {
    // 1. The finalized saved transcript is the authority. No transcript, no measurement.
    const selected = (saved.selectedForSave ?? '').trim();
    if (selected.length === 0) return { ok: false, invalidReason: 'no_finalized_saved_transcript' };

    // 2. The surface read is a precondition for a trustworthy run: a run that observed nothing on the
    //    page did not exercise what it claims to have measured, even if a saved transcript exists.
    if (!read.ok) return { ok: false, invalidReason: read.invalidReason };

    // 3. Only now is anything scored — and the SAVED text is scored, never the DOM text.
    const row = wordErrorRate(reference, selected, { track: 'track_a' });

    // 4. An unmeasurable reference is null and is NEVER coerced to 0. A fabricated perfect score is the
    //    failure this whole program exists to prevent.
    if (row.wer === null) return { ok: false, invalidReason: 'unmeasurable_reference' };
    return { ok: true, row };
}

/**
 * Aggregate WER across a corpus: Σ(S+D+I) / Σ(referenceWords).
 *
 * NEVER the mean of per-utterance WERs. That over-weights short utterances — a two-word clip with one
 * error would count as much as a two-hundred-word one — and makes the number non-comparable with every
 * published figure. Invalid runs are EXCLUDED from the aggregate and COUNTED, so a corpus that mostly
 * failed can never masquerade as a good score computed over the few that worked.
 */
export interface AggregateWer {
    wer: number | null;
    referenceWords: number;
    substitutions: number;
    deletions: number;
    insertions: number;
    scoredCount: number;
    invalidCount: number;
    invalidReasons: Record<string, number>;
}

export function aggregateBenchmarkScores(scores: readonly BenchmarkScore[]): AggregateWer {
    let refWords = 0, sub = 0, del = 0, ins = 0, scored = 0, invalid = 0;
    const invalidReasons: Record<string, number> = {};

    for (const s of scores) {
        if (!s.ok) {
            invalid += 1;
            invalidReasons[s.invalidReason] = (invalidReasons[s.invalidReason] ?? 0) + 1;
            continue;
        }
        refWords += s.row.referenceWords;
        sub += s.row.substitutions;
        del += s.row.deletions;
        ins += s.row.insertions;
        scored += 1;
    }

    return {
        // Zero reference words is UNMEASURABLE, not a perfect score.
        wer: refWords === 0 ? null : (sub + del + ins) / refWords,
        referenceWords: refWords,
        substitutions: sub, deletions: del, insertions: ins,
        scoredCount: scored, invalidCount: invalid, invalidReasons,
    };
}
