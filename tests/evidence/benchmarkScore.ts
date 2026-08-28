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
    | 'blank_utterance_id'
    | 'unmeasurable_reference';

/** What a browser harness read from the page. Mirrors `BenchmarkTranscriptRead` without importing Playwright. */
export type TranscriptRead =
    | { ok: true; text: string }
    | { ok: false; invalidReason: 'transcript_surface_absent' | 'transcript_surface_empty' };

export type ScorePath = 'product_path' | 'corpus';

/**
 * The two score kinds are DISTINCT TYPES, not one type with a discriminant field.
 *
 * A shared shape plus a `path` string relies on every caller checking it. Separate types mean the
 * compiler refuses the mix — a product-path score cannot reach corpus aggregation at all, so the
 * "paths must not mix" rule is enforced rather than documented.
 *
 * A corpus score ALWAYS carries its `utteranceId`: completeness against a frozen manifest is
 * unanswerable without it, and making it optional is what allowed a partial corpus to score.
 */
export type ProductPathScore =
    | { ok: true; path: 'product_path'; row: WerResult<'track_a'> }
    | { ok: false; path: 'product_path'; invalidReason: BenchmarkInvalidReason };

export type CorpusScore =
    | { ok: true; path: 'corpus'; utteranceId: string; row: WerResult<'track_a'> }
    | { ok: false; path: 'corpus'; utteranceId: string; invalidReason: BenchmarkInvalidReason };

export type BenchmarkScore = ProductPathScore | CorpusScore;

/** Shared tail: score, and refuse an unmeasurable reference rather than coercing it to zero. */
function scoreRow(reference: string, hypothesis: string): WerResult<'track_a'> | null {
    const row = wordErrorRate(reference, hypothesis, { track: 'track_a' });
    // A fabricated perfect score is the failure this whole program exists to prevent.
    return row.wer === null ? null : row;
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
): ProductPathScore {
    const selected = (saved.selectedForSave ?? '').trim();
    if (selected.length === 0) {
        return { ok: false, path: 'product_path', invalidReason: 'no_finalized_saved_transcript' };
    }
    // The surface read is a precondition for a TRUSTWORTHY browser run: observing nothing means the
    // run did not exercise the path it claims to have measured, even though a saved transcript exists.
    if (!read.ok) return { ok: false, path: 'product_path', invalidReason: read.invalidReason };
    const row = scoreRow(reference, selected);
    return row === null
        ? { ok: false, path: 'product_path', invalidReason: 'unmeasurable_reference' }
        : { ok: true, path: 'product_path', row };
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
): CorpusScore {
    const id = utteranceId?.trim() ?? '';
    // A blank id makes completeness unanswerable — it cannot be matched against the manifest, deduped,
    // or reported as missing. It is rejected here rather than at the aggregate, where it would already
    // have polluted the totals.
    if (id.length === 0) return { ok: false, path: 'corpus', utteranceId, invalidReason: 'blank_utterance_id' };
    const hyp = (hypothesis ?? '').trim();
    // An empty decode is a RESULT — the model produced nothing — and must be named, not scored as a
    // total miss and not silently dropped. Either would change the arm's number.
    if (hyp.length === 0) return { ok: false, path: 'corpus', utteranceId: id, invalidReason: 'empty_hypothesis' };
    const row = scoreRow(reference, hyp);
    return row === null
        ? { ok: false, path: 'corpus', utteranceId: id, invalidReason: 'unmeasurable_reference' }
        : { ok: true, path: 'corpus', utteranceId: id, row };
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
    armInvalidReason?:
        | 'incomplete_corpus'
        | 'no_scoreable_utterances'
        | 'duplicate_utterances'
        | 'unexpected_utterances'
        | 'blank_utterance_id'
        | 'invalid_manifest';
    missingUtteranceIds?: string[];
}

/** Pooled totals over whatever scored. Shared by both entry points; neither exposes it. */
function poolTotals(scores: readonly BenchmarkScore[]) {
    let referenceWords = 0, substitutions = 0, deletions = 0, insertions = 0, scoredCount = 0, invalidCount = 0;
    const invalidReasons: Record<string, number> = {};
    for (const s of scores) {
        if (!s.ok) {
            invalidCount += 1;
            invalidReasons[s.invalidReason] = (invalidReasons[s.invalidReason] ?? 0) + 1;
            continue;
        }
        referenceWords += s.row.referenceWords;
        substitutions += s.row.substitutions;
        deletions += s.row.deletions;
        insertions += s.row.insertions;
        scoredCount += 1;
    }
    return { referenceWords, substitutions, deletions, insertions, scoredCount, invalidCount, invalidReasons };
}

const unscoreable = (
    totals: ReturnType<typeof poolTotals>,
    reason: NonNullable<AggregateWer['armInvalidReason']>,
    missingUtteranceIds?: string[],
): AggregateWer => ({ wer: null, ...totals, armInvalidReason: reason, ...(missingUtteranceIds ? { missingUtteranceIds } : {}) });

/**
 * Aggregate a CORPUS ARM against its frozen manifest.
 *
 * `expectedUtteranceIds` is REQUIRED — not optional-with-a-contract. The previous signature took it as
 * `expectedUtteranceIds?`, so a corpus caller could simply omit it and receive a WER from an incomplete
 * corpus: the exact defect the strictness was added to prevent, reachable by leaving off an argument.
 * A rule the type system does not enforce is a rule that depends on everyone remembering it.
 *
 * Pooled WER = Σ(S+D+I) / Σ(referenceWords) — never the mean of per-utterance WERs, which over-weights
 * short clips and makes the figure non-comparable with published numbers.
 *
 * The arm is scoreable ONLY when the manifest is valid and every expected utterance scored. A partial
 * corpus is not a smaller corpus — it is a DIFFERENT one, silently selected by whichever clips happened
 * to work, and the ones that fail are systematically the hard ones.
 */
export function aggregateCorpusArm(
    scores: readonly CorpusScore[],
    expectedUtteranceIds: readonly string[],
): AggregateWer {
    const totals = poolTotals(scores);

    // A manifest that cannot identify its own contents cannot certify completeness against anything.
    if (expectedUtteranceIds.length === 0) return unscoreable(totals, 'invalid_manifest');
    if (expectedUtteranceIds.some((id) => (id ?? '').trim().length === 0)) return unscoreable(totals, 'invalid_manifest');
    if (new Set(expectedUtteranceIds).size !== expectedUtteranceIds.length) return unscoreable(totals, 'invalid_manifest');

    // A blank id on a score is unmatchable: it can be neither deduped nor reported missing.
    if (scores.some((s) => (s.utteranceId ?? '').trim().length === 0)) return unscoreable(totals, 'blank_utterance_id');

    const seen = new Map<string, number>();
    for (const s of scores) seen.set(s.utteranceId, (seen.get(s.utteranceId) ?? 0) + 1);

    if ([...seen.values()].some((n) => n > 1)) return unscoreable(totals, 'duplicate_utterances');

    const expected = new Set(expectedUtteranceIds);
    if ([...seen.keys()].some((id) => !expected.has(id))) return unscoreable(totals, 'unexpected_utterances');

    // Any invalid utterance invalidates the ARM, not just itself.
    if (totals.invalidCount > 0) return unscoreable(totals, 'incomplete_corpus');

    const missing = expectedUtteranceIds.filter((id) => !seen.has(id));
    if (missing.length > 0) return unscoreable(totals, 'incomplete_corpus', missing);

    // Zero reference words is UNMEASURABLE, not a perfect score.
    if (totals.scoredCount === 0 || totals.referenceWords === 0) return unscoreable(totals, 'no_scoreable_utterances');

    return {
        wer: (totals.substitutions + totals.deletions + totals.insertions) / totals.referenceWords,
        ...totals,
    };
}

/**
 * Aggregate PRODUCT-PATH runs. A separate entry point because there is no manifest to be complete
 * against — a browser journey is not a corpus, and pretending otherwise is what coupled the two.
 *
 * Still strict about validity: any invalid run means no number.
 */
export function aggregateProductPathRuns(scores: readonly ProductPathScore[]): AggregateWer {
    const totals = poolTotals(scores);
    if (totals.invalidCount > 0) return unscoreable(totals, 'incomplete_corpus');
    if (totals.scoredCount === 0 || totals.referenceWords === 0) return unscoreable(totals, 'no_scoreable_utterances');
    return {
        wer: (totals.substitutions + totals.deletions + totals.insertions) / totals.referenceWords,
        ...totals,
    };
}
