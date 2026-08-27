import { describe, it, expect } from 'vitest';
import { wordErrorRate, normalizeTranscript, NORMALIZATION_VERSION } from '../werMetric';
import { TRACK_NORMALIZATION } from '../normalization/tracks';

// #1304: these exercise the metric mechanics under the filler-PRESERVING normalizer = Track B.
describe('#1037 werMetric — versioned normalization + honest WER', () => {
    it('normalization lowercases, strips surrounding punctuation, keeps intra-word apostrophes', () => {
        expect(normalizeTranscript("Hello, World! It's fine.")).toEqual(['hello', 'world', "it's", 'fine']);
    });

    it('preserves error markers as tokens (never silently cleaned)', () => {
        expect(normalizeTranscript('the [inaudible] cat')).toEqual(['the', '[inaudible]', 'cat']);
    });

    it('identical transcripts score 0', () => {
        expect(wordErrorRate('the quick brown fox', 'the quick brown fox', { track: 'track_b' }).wer).toBe(0);
    });

    it('counts substitutions, deletions and insertions', () => {
        // ref: a b c d ; hyp: a x c   -> b->x sub, d deletion
        const r = wordErrorRate('a b c d', 'a x c', { track: 'track_b' });
        expect(r.substitutions).toBe(1);
        expect(r.deletions).toBe(1);
        expect(r.insertions).toBe(0);
        expect(r.referenceWords).toBe(4);
        expect(r.wer).toBeCloseTo(2 / 4, 10);
    });

    it('counts an insertion', () => {
        const r = wordErrorRate('a b', 'a b c', { track: 'track_b' });
        expect(r.insertions).toBe(1);
        expect(r.wer).toBeCloseTo(1 / 2, 10);
    });

    it('an EMPTY reference is unmeasurable — wer is null, never 0', () => {
        const r = wordErrorRate('', 'anything at all', { track: 'track_b' });
        expect(r.wer).toBeNull();
        expect(r.referenceWords).toBe(0);
    });

    it('punctuation/case differences alone do not count as errors', () => {
        expect(wordErrorRate('Hello, world.', 'hello world', { track: 'track_b' }).wer).toBe(0);
    });

    it('carries the normalization version so a normalization change is a new version', () => {
        // #1304: the DEFAULT moved to norm_v2, which is precisely why this assertion changed rather
        // than silently continuing to pass — the recorded version is the mechanism that makes a
        // normalization change visible in the data instead of quietly moving a ranking.
        expect(wordErrorRate('a', 'a', { track: 'track_b' }).normalizationVersion).toBe(TRACK_NORMALIZATION.track_b);
        expect(wordErrorRate('a', 'a', { track: 'track_b', normalization: NORMALIZATION_VERSION }).normalizationVersion).toBe(NORMALIZATION_VERSION);
    });

    it('folds a typographic apostrophe to ASCII instead of splitting the word', () => {
        // U+2019 in the ground truth must not turn "don't" into "don" + "t".
        expect(normalizeTranscript('I don’t know')).toEqual(['i', "don't", 'know']);
        // norm_v1 FOLDS the typographic apostrophe. The OFFICIAL core does not — the generated goldens
        // show `I don’t know` -> `i don t know` while the ASCII form expands to `i do not know`, so under
        // the official normalization these genuinely differ. This assertion is therefore scoped to
        // norm_v1 explicitly rather than silently changing meaning under the new default.
        expect(wordErrorRate('I don’t know', "i don't know", { track: 'track_b', normalization: NORMALIZATION_VERSION }).wer).toBe(0);
    });
});
