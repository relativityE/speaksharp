/**
 * #1304 Task 3B — the seam, proven BEHAVIOURALLY.
 *
 * This replaces a source-ordering assertion (`indexOf(guard) < indexOf(scorer)`). That was fragile to
 * refactors and — more importantly — blind to the other half of the defect: an artifact and a log
 * emitted BEFORE the guard ran. With the guard inside the seam, ordering is structural.
 */
import { describe, it, expect } from 'vitest';
import {
    scoreProductPathRun, scoreCorpusUtterance, aggregateBenchmarkScores, type BenchmarkScore,
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
        const agg = aggregateBenchmarkScores([
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
        const agg = aggregateBenchmarkScores([
            utt('a', 'alpha beta', 'alpha beta'),
            utt('b', 'gamma delta', ''),          // empty decode
        ], ['a', 'b']);

        expect(agg.wer, 'a partial corpus must produce NO number').toBeNull();
        expect(agg.armInvalidReason).toBe('incomplete_corpus');
        expect(agg.invalidCount).toBe(1);
        expect(agg.scoredCount).toBe(1);
    });

    it('STRICT: a MISSING utterance invalidates the arm and names which', () => {
        const agg = aggregateBenchmarkScores([utt('a', 'alpha beta', 'alpha beta')], ['a', 'b', 'c']);
        expect(agg.wer).toBeNull();
        expect(agg.armInvalidReason).toBe('incomplete_corpus');
        expect(agg.missingUtteranceIds).toEqual(['b', 'c']);
    });

    it('STRICT: a DUPLICATED utterance invalidates the arm', () => {
        // Without id tracking, "600 scored" cannot be distinguished from "600 scores, some the same
        // clip twice" — which would weight that clip double in a pooled figure.
        const agg = aggregateBenchmarkScores([
            utt('a', 'alpha beta', 'alpha beta'),
            utt('a', 'alpha beta', 'alpha beta'),
        ], ['a', 'b']);
        expect(agg.wer).toBeNull();
        expect(agg.armInvalidReason).toBe('duplicate_utterances');
    });

    it('STRICT: an UNEXPECTED utterance invalidates the arm', () => {
        // A clip not in the frozen manifest means a different corpus was scored.
        const agg = aggregateBenchmarkScores([
            utt('a', 'alpha beta', 'alpha beta'),
            utt('rogue', 'gamma delta', 'gamma delta'),
        ], ['a']);
        expect(agg.wer).toBeNull();
        expect(agg.armInvalidReason).toBe('unexpected_utterances');
    });

    it('a COMPLETE corpus scores normally — the positive control', () => {
        // Without this, an aggregate that always returned null would pass every assertion above.
        const agg = aggregateBenchmarkScores([
            utt('a', 'alpha beta', 'alpha beta'),
            utt('b', 'gamma delta', 'gamma delta'),
        ], ['a', 'b']);
        expect(agg.wer).toBe(0);
        expect(agg.armInvalidReason).toBeUndefined();
        expect(agg.scoredCount).toBe(2);
    });

    it('an empty corpus is UNMEASURABLE, not 0% WER', () => {
        expect(aggregateBenchmarkScores([], []).wer).toBeNull();
        expect(aggregateBenchmarkScores([], []).armInvalidReason).toBe('no_scoreable_utterances');
    });

    it('invalid reasons are counted BY NAME so a failure mode is legible', () => {
        const agg = aggregateBenchmarkScores([
            utt('a', 'alpha beta', ''),
            utt('b', 'gamma delta', ''),
            { ok: false, path: 'corpus', utteranceId: 'c', invalidReason: 'unmeasurable_reference' } as BenchmarkScore,
        ], ['a', 'b', 'c']);
        expect(agg.invalidReasons).toEqual({ empty_hypothesis: 2, unmeasurable_reference: 1 });
    });
});
