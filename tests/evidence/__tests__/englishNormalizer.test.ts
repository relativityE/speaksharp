/**
 * #1304 — `norm_v2` regression suite.
 *
 * Every case below is a SEMANTICALLY PERFECT transcript. Under `norm_v1` they scored 8.3% / 25% /
 * 33.3% / 50% / 71.4% while a byte-identical pair scored 0 — so the edit distance was never wrong, the
 * normalization was, and every model comparison built on those numbers was partly measuring spelling.
 */
import { describe, it, expect } from 'vitest';
import { wordErrorRate, NORMALIZATION_VERSION } from '../werMetric';
import { TRACK_NORMALIZATION } from '../normalization/tracks';
import { normalizeEnglish } from '../englishNormalizer';

// TRACK B — this file exercises the filler-PRESERVING normalizer, which is Track B's.
const wer = (ref: string, hyp: string) => wordErrorRate(ref, hyp, { track: 'track_b' }).wer;

describe('norm_v2 scores a semantically perfect transcript at zero', () => {
    it.each([
        ['digits', 'The meeting starts at nine. Please arrive early. Thank you very much.', 'The meeting starts at 9. Please arrive early. Thank you very much.'],
        ['decimal + percent', 'accuracy improved to twenty one point four percent this quarter', 'accuracy improved to 21.4% this quarter'],
        ['hyphenated number', 'twenty-one people attended', '21 people attended'],
        ['contraction', 'I do not think we should cancel it', "I don't think we should cancel it"],
        ['contraction (reverse)', "we're not going to wait", 'we are not going to wait'],
        ['british spelling', 'the colour of the centre panel', 'the color of the center panel'],
        ['decimal currency', 'it costs five dollars and fifty cents', 'it costs $5.50'],
        ['thousands', 'we sold one thousand two hundred units', 'we sold 1200 units'],
        ['grouped digits', 'we sold one thousand two hundred units', 'we sold 1,200 units'],
        ['identical', 'So um I think uh we should um review the plan today', 'So um I think uh we should um review the plan today'],
    ])('%s', (_label, ref, hyp) => {
        expect(wer(ref, hyp)).toBe(0);
    });
});

describe('the two deliberate deviations from the upstream normalizer', () => {
    it('KEEPS fillers — this product measures them', () => {
        // Upstream Whisper normalization deletes um/uh/hmm as noise. fixture-003 exists to score filler
        // recognition; deleting them would erase the signal and flatter any model that drops them.
        expect(normalizeEnglish('so um I think uh we should review')).toContain('um');
        expect(normalizeEnglish('so um I think uh we should review')).toContain('uh');
        // A recognizer that silently drops the fillers must still be PENALISED.
        expect(wer('so um I think uh we should review', 'so I think we should review')).toBeGreaterThan(0);
    });

    it('KEEPS error markers as tokens', () => {
        expect(normalizeEnglish('the [inaudible] part')).toEqual(['the', '[inaudible]', 'part']);
        expect(wer('the [inaudible] part', 'the part')).toBeGreaterThan(0);
    });
});

describe('real recognition error is still measured', () => {
    it('a genuine substitution is not normalized away', () => {
        expect(wer('the quick brown fox', 'the quick brown box')).toBeCloseTo(0.25);
    });
    it('a dropped word still counts', () => {
        expect(wer('the quick brown fox', 'the quick fox')).toBeCloseTo(0.25);
    });
    it('an unmeasurable reference is null, never a flattering zero', () => {
        expect(wordErrorRate('', 'anything at all', { track: 'track_b' }).wer).toBeNull();
    });
});

describe('versioning', () => {
    it('records which normalization produced the score', () => {
        expect(wordErrorRate('a b', 'a b', { track: 'track_b' }).normalizationVersion).toBe(TRACK_NORMALIZATION.track_b);
        expect(wordErrorRate('a b', 'a b', { track: 'track_b', normalization: NORMALIZATION_VERSION }).normalizationVersion).toBe(NORMALIZATION_VERSION);
    });

    it('norm_v1 REMAINS reproducible for rows already pinned to it', () => {
        // The old numbers must not move retroactively — that is the whole point of versioning.
        const v1 = wordErrorRate('the colour of the centre panel', 'the color of the center panel', { track: 'track_b', normalization: NORMALIZATION_VERSION });
        expect(v1.wer).toBeCloseTo(1 / 3);
        expect(v1.normalizationVersion).toBe(NORMALIZATION_VERSION);
    });
});
