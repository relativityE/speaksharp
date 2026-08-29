/**
 * #1304 Task 3C — THE HARNESS'S OWN SCORING PATH.
 *
 * Every number the certified harness produces passes through here. It is a thin delegation to the
 * #1362 seam on purpose: the value is that there is exactly ONE path, so "the harness scores with the
 * certified scorer" is provable by running the harness rather than by reading its imports.
 *
 * That distinction is not pedantic. Both retired harnesses imported something reasonable-looking and
 * then computed a mean of per-utterance WERs over surviving rows — the arithmetic diverged from the
 * intent well after the import statement. Certification therefore drives the OFFICIAL VECTORS THROUGH
 * THIS ADAPTER, not through the normalizer directly, so a divergence anywhere between this entry point
 * and the scorer fails the gate.
 */
import { scoreCorpusUtterance, aggregateCorpusArm, type CorpusScore, type AggregateWer } from '../benchmarkScore';
import { normalizeOfficialTrackA } from '../normalization/officialNormalizer';
import { CERTIFICATION_RULES } from './rules';

export type { CorpusScore, AggregateWer };

/**
 * Score one utterance. `hypothesis` is whatever the engine returned, including nothing — an empty
 * decode is a RESULT and is named, never silently dropped and never scored as a total miss.
 */
export function scoreUtterance(utteranceId: string, reference: string, hypothesis: string | null): CorpusScore {
    return scoreCorpusUtterance(utteranceId, reference, hypothesis);
}

/**
 * Pool an arm against the frozen manifest's ids. `expectedUtteranceIds` is REQUIRED by the seam, so a
 * partial corpus cannot be aggregated by omitting an argument.
 */
export function aggregateArm(scores: readonly CorpusScore[], expectedUtteranceIds: readonly string[]): AggregateWer {
    return aggregateCorpusArm(scores, expectedUtteranceIds);
}

/**
 * The EXACT token sequence the scorer will compare — `wordErrorRate` calls this same function for
 * Track A. Exposed so certification can hold it against the oracle's own output, and covered by a test
 * that scores real text and checks the reported `referenceWords` against what this returns: if the two
 * ever became separate code paths, that test fails rather than this quietly describing a fiction.
 */
export function scoringTokens(text: string): readonly string[] {
    return normalizeOfficialTrackA(text);
}

export interface OracleVectorFailure {
    category: string;
    input: string;
    expected: string;
    /** What the adapter made of the pair: a non-zero WER means the two did not normalize alike. */
    wer: number | null;
    invalidReason?: string;
}

export interface OracleGateResult {
    ok: boolean;
    vectorsRun: number;
    vectorsRequired: number;
    failures: OracleVectorFailure[];
    /** Vectors whose EXPECTED text re-normalizes to something else — reported, never silently skipped. */
    nonIdempotentInputs: string[];
}

/**
 * GATE — every official vector, through the harness's own scoring normalization.
 *
 * The oracle's `expected` value IS normalized text, so the check is exact: the tokens this adapter
 * will compare for `input` must be precisely the words of `expected`. No tolerance, no sampling.
 *
 * A SECOND, weaker check then drives the pair through `scoreUtterance` itself and requires WER 0,
 * which proves the tokens actually reach the arithmetic rather than being computed alongside it.
 *
 * WHY THE TWO ARE NOT THE SAME CHECK. The official normalizer is NOT IDEMPOTENT: it maps `"..."` to
 * `"."`, and `"."` to nothing at all. Re-normalizing an already-normalized reference therefore changes
 * it, so the WER form of the check cannot hold for such a vector — through no fault of the scorer.
 * This is harmless in real scoring, where BOTH sides are raw text normalized exactly once. Rather than
 * write a general "skip unmeasurable vectors" rule — which would let a genuine divergence hide behind
 * an exemption — the affected inputs are ENUMERATED in the immutable rules and any newcomer fails.
 */
export function runOracleVectorGate(
    vectors: readonly { category: string; input: string; expected: string }[],
): OracleGateResult {
    const failures: OracleVectorFailure[] = [];
    const nonIdempotentInputs: string[] = [];

    for (const [index, vector] of vectors.entries()) {
        const tokens = scoringTokens(vector.input);
        const expectedTokens = vector.expected.split(/\s+/).filter((t) => t.length > 0);

        // EXACT agreement with the oracle. This is the check that certifies the normalization.
        if (tokens.join(' ') !== expectedTokens.join(' ')) {
            failures.push({ ...vector, wer: null, invalidReason: 'normalization_differs_from_oracle' });
            continue;
        }

        // Both sides reduce to NOTHING, and the exact check above already confirmed they agree. WER is
        // undefined without reference words, so there is no arithmetic left to drive — asserting a
        // score here would be asserting a fabricated one, which is the failure this program exists to
        // prevent.
        if (expectedTokens.length === 0) continue;

        // Does the expected text survive re-normalization? If not, the WER form below is inapplicable.
        if (scoringTokens(vector.expected).join(' ') !== expectedTokens.join(' ')) {
            nonIdempotentInputs.push(vector.input);
            continue;
        }

        const score = scoreUtterance(`oracle-${index}`, vector.expected, vector.input);
        if (!score.ok) {
            failures.push({ ...vector, wer: null, invalidReason: score.invalidReason });
            continue;
        }
        if (score.row.wer !== 0) failures.push({ ...vector, wer: score.row.wer });
    }

    const unexpectedNonIdempotent = nonIdempotentInputs.filter(
        (input) => !CERTIFICATION_RULES.nonIdempotentOracleInputs.includes(input),
    );

    return {
        // The COUNT is part of the gate. A vector file that silently shrank would otherwise pass with a
        // handful of cases, and "all 68 vectors" would quietly become "all of whatever was left".
        ok:
            failures.length === 0 &&
            unexpectedNonIdempotent.length === 0 &&
            vectors.length === CERTIFICATION_RULES.requiredOracleVectors,
        vectorsRun: vectors.length,
        vectorsRequired: CERTIFICATION_RULES.requiredOracleVectors,
        failures,
        nonIdempotentInputs,
    };
}
