/**
 * #1304 Task 3B — THE SCORING SEAM.
 *
 * The only path from a run to a WER row, with the invalid-run guard INSIDE, so "the guard runs before
 * scoring" is true by construction rather than by a source-order assertion. That earlier assertion was
 * fragile to refactors AND blind to the other half of the defect — an artifact and a log emitted
 * before the guard ran. Source order says nothing about what a function did.
 *
 * TWO SCORING PATHS, DELIBERATELY SEPARATE (RETURN correction):
 *
 *   PRODUCT PATH  — a browser run. The rendered surface must have been observed, because a run that
 *                   saw nothing did not exercise what it claims to have measured. The FINALIZED SAVED
 *                   transcript is what gets scored, never the DOM text.
 *   CORPUS PATH   — a direct worker/Node decode. There is NO PAGE, so requiring a rendered surface was
 *                   simply wrong: it coupled corpus scoring to a browser concept that does not exist
 *                   there. The first version made this mistake by deriving the corpus case from the
 *                   browser case.
 *
 * Both produce the same `WerResult<'track_a'>` row, so an aggregate never mixes tracks or paths
 * silently — the path is recorded on every score.
 */
import { wordErrorRate, type WerResult } from './werMetric';

/** Why a run produced no row. Every reason is NAMED — absence is never a silent empty score. */
export type BenchmarkInvalidReason =
    | 'transcript_surface_absent'
    | 'transcript_surface_empty'
    | 'no_finalized_saved_transcript'
    | 'empty_hypothesis'
    | 'unmeasurable_reference';

/** What a browser harness read from the page. Mirrors `BenchmarkTranscriptRead` without importing Playwright. */
export type TranscriptRead =
    | { ok: true; text: string }
    | { ok: false; invalidReason: 'transcript_surface_absent' | 'transcript_surface_empty' };

export type ScorePath = 'product_path' | 'corpus';

export type BenchmarkScore =
    | { ok: true; path: ScorePath; utteranceId?: string; row: WerResult<'track_a'> }
    | { ok: false; path: ScorePath; utteranceId?: string; invalidReason: BenchmarkInvalidReason };

/** Shared tail: score, and refuse an unmeasurable reference rather than coercing it to zero. */
function scoreOrRefuse(path: ScorePath, reference: string, hypothesis: string, utteranceId?: string): BenchmarkScore {
    const row = wordErrorRate(reference, hypothesis, { track: 'track_a' });
    // A fabricated perfect score is the failure this whole program exists to prevent.
    if (row.wer === null) return { ok: false, path, utteranceId, invalidReason: 'unmeasurable_reference' };
    return { ok: true, path, utteranceId, row };
}

/**
 * PRODUCT PATH — score one browser benchmark run.
 *
 * `saved.selectedForSave` is the finalized transcript the product chose to persist: the authoritative
 * text, not whatever happened to be painted on screen. Checked FIRST, because a run with no finalized
 * transcript is invalid and an invalid run must leave no number and no artifact behind.
 */
export function scoreProductPathRun(
    read: TranscriptRead,
    reference: string,
    saved: { selectedForSave: string | null | undefined },
): BenchmarkScore {
    const selected = (saved.selectedForSave ?? '').trim();
    if (selected.length === 0) {
        return { ok: false, path: 'product_path', invalidReason: 'no_finalized_saved_transcript' };
    }
    // The surface read is a precondition for a TRUSTWORTHY browser run: observing nothing means the
    // run did not exercise the path it claims to have measured, even though a saved transcript exists.
    if (!read.ok) return { ok: false, path: 'product_path', invalidReason: read.invalidReason };
    return scoreOrRefuse('product_path', reference, selected);
}

/**
 * CORPUS PATH — score one direct decode. No page, no rendered surface, no saved-transcript concept.
 *
 * `utteranceId` is REQUIRED so completeness can be checked against the frozen manifest: an aggregate
 * cannot tell "600 utterances scored" from "600 scores, some of them the same clip twice" without it.
 */
export function scoreCorpusUtterance(
    utteranceId: string,
    reference: string,
    hypothesis: string | null | undefined,
): BenchmarkScore {
    const hyp = (hypothesis ?? '').trim();
    // An empty decode is a RESULT — the model produced nothing — and must be named, not scored as a
    // total miss and not silently dropped. Either would change the arm's number.
    if (hyp.length === 0) return { ok: false, path: 'corpus', utteranceId, invalidReason: 'empty_hypothesis' };
    return scoreOrRefuse('corpus', reference, hyp, utteranceId);
}

export interface AggregateWer {
    /** null whenever the arm is not scoreable. NEVER a partial figure. */
    wer: number | null;
    referenceWords: number;
    substitutions: number;
    deletions: number;
    insertions: number;
    scoredCount: number;
    invalidCount: number;
    invalidReasons: Record<string, number>;
    /** Present only when the arm is invalid — why it produced no number. */
    armInvalidReason?: 'incomplete_corpus' | 'no_scoreable_utterances' | 'duplicate_utterances' | 'unexpected_utterances';
    missingUtteranceIds?: string[];
}

/**
 * Aggregate an ARM. Pooled WER = Σ(S+D+I) / Σ(referenceWords) — never the mean of per-utterance WERs,
 * which over-weights short clips and makes the figure non-comparable with every published number.
 *
 * STRICT COMPLETENESS (RETURN correction). The first version returned a WER whenever ANY utterance
 * scored, with the failures counted in a separate field nobody was forced to read. One success among
 * six hundred failures produced a plausible number. An arm is now scoreable ONLY when every expected
 * utterance scored: any missing, invalid, duplicated or unexpected item invalidates the arm and `wer`
 * is null. A partial corpus is not a smaller corpus — it is a different one, silently selected by
 * whichever clips happened to work.
 *
 * @param expectedUtteranceIds the frozen manifest's ids. Omit ONLY for a product-path run, which has
 *                             no manifest; corpus arms must always pass it.
 */
export function aggregateBenchmarkScores(
    scores: readonly BenchmarkScore[],
    expectedUtteranceIds?: readonly string[],
): AggregateWer {
    let refWords = 0, sub = 0, del = 0, ins = 0, scored = 0, invalid = 0;
    const invalidReasons: Record<string, number> = {};
    const seen = new Map<string, number>();

    for (const s of scores) {
        if (s.utteranceId !== undefined) seen.set(s.utteranceId, (seen.get(s.utteranceId) ?? 0) + 1);
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

    const totals = {
        referenceWords: refWords, substitutions: sub, deletions: del, insertions: ins,
        scoredCount: scored, invalidCount: invalid, invalidReasons,
    };
    const unscoreable = (
        reason: NonNullable<AggregateWer['armInvalidReason']>,
        missing?: string[],
    ): AggregateWer => ({ wer: null, ...totals, armInvalidReason: reason, ...(missing ? { missingUtteranceIds: missing } : {}) });

    // Any invalid utterance invalidates the ARM — not just itself.
    if (invalid > 0) return unscoreable('incomplete_corpus');

    if (expectedUtteranceIds) {
        const expected = new Set(expectedUtteranceIds);
        const duplicates = [...seen.entries()].filter(([, n]) => n > 1);
        if (duplicates.length > 0) return unscoreable('duplicate_utterances');
        const unexpected = [...seen.keys()].filter((id) => !expected.has(id));
        if (unexpected.length > 0) return unscoreable('unexpected_utterances');
        const missing = expectedUtteranceIds.filter((id) => !seen.has(id));
        if (missing.length > 0) return unscoreable('incomplete_corpus', missing);
    }

    // Zero reference words is UNMEASURABLE, not a perfect score.
    if (scored === 0 || refWords === 0) return unscoreable('no_scoreable_utterances');
    return { wer: (sub + del + ins) / refWords, ...totals };
}
