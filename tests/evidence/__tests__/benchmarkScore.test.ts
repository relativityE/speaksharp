/**
 * #1304 Task 3B — the seam, proven BEHAVIOURALLY.
 *
 * This replaces a source-ordering assertion (`indexOf(guard) < indexOf(scorer)`). That was fragile to
 * refactors and — more importantly — blind to the other half of the defect: an artifact and a log
 * emitted BEFORE the guard ran. With the guard inside the seam, ordering is structural.
 */
import { describe, it, expect } from 'vitest';
import {
    scoreProductPathRun, scoreCorpusUtterance, aggregateCorpusArm, aggregateProductPathRuns,
    type CorpusScore,
} from '../benchmarkScore';
import { TRACK_NORMALIZATION } from '../normalization/tracks';

const READ_OK = { ok: true as const, text: 'the quick brown fox' };
const SAVED = { selectedForSave: 'the quick brown fox' };

describe('PRODUCT PATH — an invalid run produces NO row', () => {
    it('no finalized saved transcript -> named reason, no row', () => {
        const out = scoreProductPathRun(READ_OK, 'the quick brown fox', { selectedForSave: null });
        expect(out).toEqual({ ok: false, path: 'product_path', invalidReason: 'no_finalized_saved_transcript' });
        expect('row' in out, 'an invalid run must leave no number behind').toBe(false);
    });

    it('whitespace-only saved transcript is not a transcript', () => {
        expect(scoreProductPathRun(READ_OK, 'ref words here', { selectedForSave: '   ' }))
            .toMatchObject({ ok: false, invalidReason: 'no_finalized_saved_transcript' });
    });

    it('an unobserved surface invalidates the run even when a transcript was saved', () => {
        // A browser run that saw nothing did not exercise the path it claims to have measured.
        expect(scoreProductPathRun({ ok: false, invalidReason: 'transcript_surface_absent' }, 'ref', SAVED))
            .toMatchObject({ ok: false, invalidReason: 'transcript_surface_absent' });
    });

    it('THE ORDERING, structurally: the saved-transcript guard precedes everything', () => {
        // Both preconditions fail at once; the saved-transcript reason is returned, which is only
        // possible if that check runs first. No source text is read to establish this.
        expect(scoreProductPathRun(
            { ok: false, invalidReason: 'transcript_surface_absent' }, '', { selectedForSave: null },
        )).toMatchObject({ invalidReason: 'no_finalized_saved_transcript' });
    });

    it('scores the SAVED text, not the DOM text', () => {
        expect(scoreProductPathRun(
            { ok: true, text: 'completely different words on screen' },
            'the quick brown fox', { selectedForSave: 'the quick brown fox' },
        )).toMatchObject({ ok: true, path: 'product_path', row: { wer: 0, track: 'track_a' } });
    });
});

describe('CORPUS PATH — DOM-free, because there is no page', () => {
    it('scores a direct decode with NO rendered-surface concept at all', () => {
        // The first version required a `TranscriptRead` here, coupling corpus scoring to a browser
        // concept that does not exist in a worker/Node decode. That was the RETURN.
        const out = scoreCorpusUtterance('1089-134686-0000', 'the quick brown fox', 'the quick brown fox');
        expect(out).toMatchObject({
            ok: true, path: 'corpus', utteranceId: '1089-134686-0000',
            row: { track: 'track_a', wer: 0, referenceWords: 4, normalizationVersion: TRACK_NORMALIZATION.track_a },
        });
    });

    it('an EMPTY decode is a named result, never a silent drop and never a scored total miss', () => {
        // Either alternative changes the arm's number: dropping shrinks the corpus, scoring it as a
        // total miss invents an error rate the model did not produce.
        expect(scoreCorpusUtterance('u1', 'some reference words', ''))
            .toEqual({ ok: false, path: 'corpus', utteranceId: 'u1', invalidReason: 'empty_hypothesis' });
        expect(scoreCorpusUtterance('u1', 'some reference words', null))
            .toMatchObject({ invalidReason: 'empty_hypothesis' });
    });

    it('an unmeasurable reference is NULL, never a flattering zero', () => {
        expect(scoreCorpusUtterance('u1', '', 'anything at all'))
            .toMatchObject({ ok: false, invalidReason: 'unmeasurable_reference' });
    });
});

describe('AGGREGATE — pooled, and STRICT about completeness', () => {
    const utt = (id: string, reference: string, hypothesis: string) =>
        scoreCorpusUtterance(id, reference, hypothesis);

    it('pooled WER = Σ(S+D+I)/Σ(refWords), not the mean of per-utterance WERs', () => {
        // 2-word clip with 1 error is 50%; 20-word clip with 1 error is 5%. The MEAN is 27.5%.
        // Token-weighted is 2/22 = 9.09% — the honest figure and the one published numbers use.
        const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india',
            'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango'];
        const long = WORDS.join(' ');
        const ids = ['short', 'long'];
        const agg = aggregateCorpusArm([
            utt('short', 'uniform victor', 'uniform wrong'),
            utt('long', long, long.replace('alpha', 'wrong')),
        ], ids);

        expect(agg.referenceWords).toBe(22);
        expect(agg.substitutions + agg.deletions + agg.insertions).toBe(2);
        expect(agg.wer).toBeCloseTo(2 / 22, 6);
        expect(agg.wer, 'must NOT be the mean of 50% and 5%').not.toBeCloseTo(0.275, 3);
    });

    it('STRICT: ONE invalid utterance invalidates the ARM — no partial WER', () => {
        // THE RETURN. Previously this returned a WER whenever anything scored, with failures in a
        // counter nobody had to read: one success among six hundred failures produced a plausible
        // number. A partial corpus is not a smaller corpus — it is a DIFFERENT one, silently selected
        // by whichever clips happened to work.
        const agg = aggregateCorpusArm([
            utt('a', 'alpha beta', 'alpha beta'),
            utt('b', 'gamma delta', ''),          // empty decode
        ], ['a', 'b']);

        expect(agg.wer, 'a partial corpus must produce NO number').toBeNull();
        expect(agg.armInvalidReason).toBe('incomplete_corpus');
        expect(agg.invalidCount).toBe(1);
        expect(agg.scoredCount).toBe(1);
    });

    it('STRICT: a MISSING utterance invalidates the arm and names which', () => {
        const agg = aggregateCorpusArm([utt('a', 'alpha beta', 'alpha beta')], ['a', 'b', 'c']);
        expect(agg.wer).toBeNull();
        expect(agg.armInvalidReason).toBe('incomplete_corpus');
        expect(agg.missingUtteranceIds).toEqual(['b', 'c']);
    });

    it('STRICT: a DUPLICATED utterance invalidates the arm', () => {
        // Without id tracking, "600 scored" cannot be distinguished from "600 scores, some the same
        // clip twice" — which would weight that clip double in a pooled figure.
        const agg = aggregateCorpusArm([
            utt('a', 'alpha beta', 'alpha beta'),
            utt('a', 'alpha beta', 'alpha beta'),
        ], ['a', 'b']);
        expect(agg.wer).toBeNull();
        expect(agg.armInvalidReason).toBe('duplicate_utterances');
    });

    it('STRICT: an UNEXPECTED utterance invalidates the arm', () => {
        // A clip not in the frozen manifest means a different corpus was scored.
        const agg = aggregateCorpusArm([
            utt('a', 'alpha beta', 'alpha beta'),
            utt('rogue', 'gamma delta', 'gamma delta'),
        ], ['a']);
        expect(agg.wer).toBeNull();
        expect(agg.armInvalidReason).toBe('unexpected_utterances');
    });

    it('a COMPLETE corpus scores normally — the positive control', () => {
        // Without this, an aggregate that always returned null would pass every assertion above.
        const agg = aggregateCorpusArm([
            utt('a', 'alpha beta', 'alpha beta'),
            utt('b', 'gamma delta', 'gamma delta'),
        ], ['a', 'b']);
        expect(agg.wer).toBe(0);
        expect(agg.armInvalidReason).toBeUndefined();
        expect(agg.scoredCount).toBe(2);
    });

    it('an empty corpus is UNMEASURABLE, not 0% WER', () => {
        // An EMPTY manifest cannot certify completeness against anything — it is an invalid manifest,
        // not an arm that happened to score nothing.
        expect(aggregateCorpusArm([], []).wer).toBeNull();
        expect(aggregateCorpusArm([], []).armInvalidReason).toBe('invalid_manifest');
        // A valid manifest with no scores at all is the no-scoreable-utterances case.
        expect(aggregateCorpusArm([], ['a']).armInvalidReason).toBe('incomplete_corpus');
    });

    it('invalid reasons are counted BY NAME so a failure mode is legible', () => {
        const agg = aggregateCorpusArm([
            utt('a', 'alpha beta', ''),
            utt('b', 'gamma delta', ''),
            { ok: false, path: 'corpus', utteranceId: 'c', invalidReason: 'unmeasurable_reference' } as CorpusScore,
        ], ['a', 'b', 'c']);
        expect(agg.invalidReasons).toEqual({ empty_hypothesis: 2, unmeasurable_reference: 1 });
    });
});

describe('the manifest is REQUIRED, and the paths cannot mix — enforced, not documented', () => {
    const utt = (id: string, reference: string, hypothesis: string) =>
        scoreCorpusUtterance(id, reference, hypothesis);

    it('COMPILE-TIME: corpus aggregation cannot be called without expected ids', () => {
        // THE REMAINING BYPASS. The signature was `aggregateBenchmarkScores(scores, expected?)`, so a
        // corpus caller could simply omit the manifest and receive a WER from an incomplete corpus —
        // the exact defect the strictness exists to prevent, reachable by leaving off an argument.
        // A rule the type system does not enforce is a rule that depends on everyone remembering it.
        // Never INVOKED — the point is that this does not compile. Executing it would only prove that
        // a missing argument throws at runtime, which is a weaker and different claim.
        const wouldNotCompile = () =>
            // @ts-expect-error — the expected-manifest argument is required. If it is ever made
            // optional again, this directive becomes unused and `typecheck:evidence` FAILS.
            aggregateCorpusArm([scoreCorpusUtterance('a', 'alpha beta', 'alpha beta')]);
        expect(typeof wouldNotCompile).toBe('function');
    });

    it('COMPILE-TIME: a product-path score cannot enter corpus aggregation', () => {
        const product = scoreProductPathRun(READ_OK, 'the quick brown fox', SAVED);
        const wouldNotCompile = () =>
            // @ts-expect-error — ProductPathScore is not a CorpusScore: it has no utteranceId, so
            // completeness against a manifest is unanswerable for it.
            aggregateCorpusArm([product], ['a']);
        expect(typeof wouldNotCompile).toBe('function');
        expect(product.path).toBe('product_path');
    });

    it('a DUPLICATE id in the expected manifest is an invalid manifest', () => {
        // A manifest that lists the same clip twice cannot state how many distinct utterances an arm
        // must cover, so completeness is undefined before any score is considered.
        const agg = aggregateCorpusArm([utt('a', 'alpha beta', 'alpha beta')], ['a', 'a']);
        expect(agg.wer).toBeNull();
        expect(agg.armInvalidReason).toBe('invalid_manifest');
    });

    it('a BLANK id in the expected manifest is an invalid manifest', () => {
        expect(aggregateCorpusArm([utt('a', 'alpha beta', 'alpha beta')], ['a', '  ']).armInvalidReason)
            .toBe('invalid_manifest');
    });

    it('a BLANK utterance id is rejected at the SCORE, before it can pollute totals', () => {
        const scored = scoreCorpusUtterance('   ', 'alpha beta', 'alpha beta');
        expect(scored).toMatchObject({ ok: false, path: 'corpus', invalidReason: 'blank_utterance_id' });
    });

    it('PRODUCT PATH has its own entry point and is still strict about validity', () => {
        expect(aggregateProductPathRuns([scoreProductPathRun(READ_OK, 'the quick brown fox', SAVED)]).wer).toBe(0);
        expect(aggregateProductPathRuns([
            scoreProductPathRun(READ_OK, 'the quick brown fox', SAVED),
            scoreProductPathRun(READ_OK, 'ref', { selectedForSave: null }),
        ]).wer, 'one invalid run means no number').toBeNull();
    });
});
