/**
 * #1304 Task 3B — the seam, proven BEHAVIOURALLY.
 *
 * This replaces a source-ordering assertion (`indexOf(guard) < indexOf(scorer)`). That check was
 * fragile to comments and refactors, and — more importantly — it could not see the other half of the
 * defect: an artifact and a log emitted BEFORE the guard ran. With the guard inside the seam, ordering
 * is structural and the only thing left to test is behaviour.
 */
import { describe, it, expect } from 'vitest';
import { scoreBenchmarkRun, aggregateBenchmarkScores, type BenchmarkScore } from '../benchmarkScore';
import { TRACK_NORMALIZATION } from '../normalization/tracks';

const READ_OK = { ok: true as const, text: 'the quick brown fox' };
const SAVED = { selectedForSave: 'the quick brown fox' };

describe('an invalid run produces NO row', () => {
    it('no finalized saved transcript -> named reason, no row', () => {
        const out = scoreBenchmarkRun(READ_OK, 'the quick brown fox', { selectedForSave: null });
        expect(out).toEqual({ ok: false, invalidReason: 'no_finalized_saved_transcript' });
        expect('row' in out, 'an invalid run must leave no number behind').toBe(false);
    });

    it('whitespace-only saved transcript is not a transcript', () => {
        expect(scoreBenchmarkRun(READ_OK, 'ref words here', { selectedForSave: '   ' }))
            .toEqual({ ok: false, invalidReason: 'no_finalized_saved_transcript' });
    });

    it('an absent surface -> the read reason survives into the score', () => {
        const out = scoreBenchmarkRun({ ok: false, invalidReason: 'transcript_surface_absent' }, 'ref', SAVED);
        expect(out).toEqual({ ok: false, invalidReason: 'transcript_surface_absent' });
    });

    it('an unmeasurable reference is NULL, never a flattering zero', () => {
        expect(scoreBenchmarkRun(READ_OK, '', SAVED))
            .toEqual({ ok: false, invalidReason: 'unmeasurable_reference' });
    });

    it('THE ORDERING, structurally: the saved-transcript guard precedes scoring', () => {
        // Both preconditions fail at once. The saved-transcript reason is returned, which is only
        // possible if that check runs FIRST. No source text is read to establish this.
        const out = scoreBenchmarkRun(
            { ok: false, invalidReason: 'transcript_surface_absent' }, '', { selectedForSave: null },
        );
        expect(out).toEqual({ ok: false, invalidReason: 'no_finalized_saved_transcript' });
    });
});

describe('a valid run scores the SAVED text on Track A', () => {
    it('produces a track_a row with S/D/I and referenceWords', () => {
        const out = scoreBenchmarkRun(READ_OK, 'the quick brown fox', SAVED);
        expect(out).toMatchObject({
            ok: true,
            row: { track: 'track_a', wer: 0, referenceWords: 4, normalizationVersion: TRACK_NORMALIZATION.track_a },
        });
    });

    it('scores the SAVED transcript, not the DOM text', () => {
        // The page shows something different from what was persisted. The saved text is authoritative;
        // scraping the surface measured whatever happened to be painted, including interim output.
        const out = scoreBenchmarkRun(
            { ok: true, text: 'completely different words on screen' },
            'the quick brown fox',
            { selectedForSave: 'the quick brown fox' },
        );
        expect(out).toMatchObject({ ok: true, row: { wer: 0 } });
    });
});

describe('aggregate WER is Σ(S+D+I) / Σ(refWords), never the mean of per-utterance WERs', () => {
    const score = (reference: string, hypothesis: string): BenchmarkScore =>
        scoreBenchmarkRun({ ok: true, text: hypothesis }, reference, { selectedForSave: hypothesis });

    it('a long clean utterance is not outweighed by a short broken one', () => {
        // Short: 2 reference words, 1 substitution -> per-utterance 50%.
        // Long: 20 reference words, 1 substitution -> per-utterance 5%.
        // MEAN would be 27.5%. TOKEN-WEIGHTED is 2/22 = 9.09% — the honest figure, and the one every
        // published number uses.
        // Plain alphabetic words: the official normalizer splits a digit-suffixed token (`word0` ->
        // `word 0`, its documented number/letter boundary rule), which silently doubled my first
        // fixture's reference count. The scorer was right; the fixture was wrong.
        const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india',
            'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango'];
        const long = WORDS.join(' ');
        const longHyp = long.replace('alpha', 'wrong');
        const agg = aggregateBenchmarkScores([score('uniform victor', 'uniform wrong'), score(long, longHyp)]);

        expect(agg.referenceWords).toBe(22);
        expect(agg.substitutions + agg.deletions + agg.insertions).toBe(2);
        expect(agg.wer).toBeCloseTo(2 / 22, 6);
        expect(agg.wer, 'must NOT be the mean of 50% and 5%').not.toBeCloseTo(0.275, 3);
    });

    it('invalid runs are EXCLUDED from the aggregate and COUNTED by reason', () => {
        // Otherwise a corpus that mostly failed masquerades as a good score over the few that worked.
        const agg = aggregateBenchmarkScores([
            score('alpha beta', 'alpha beta'),
            { ok: false, invalidReason: 'transcript_surface_absent' },
            { ok: false, invalidReason: 'no_finalized_saved_transcript' },
            { ok: false, invalidReason: 'no_finalized_saved_transcript' },
        ]);
        expect(agg.scoredCount).toBe(1);
        expect(agg.invalidCount).toBe(3);
        expect(agg.invalidReasons).toEqual({
            transcript_surface_absent: 1, no_finalized_saved_transcript: 2,
        });
        expect(agg.referenceWords).toBe(2);
    });

    it('an empty corpus is UNMEASURABLE, not 0% WER', () => {
        expect(aggregateBenchmarkScores([]).wer).toBeNull();
        expect(aggregateBenchmarkScores([{ ok: false, invalidReason: 'unmeasurable_reference' }]).wer).toBeNull();
    });
});
