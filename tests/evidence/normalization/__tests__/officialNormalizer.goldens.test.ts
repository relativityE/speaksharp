/**
 * #1304 — Track A verified against the GENERATED goldens. ALL 68, no exemptions.
 *
 * The goldens come from running the real `EnglishTextNormalizer` at a pinned upstream commit. There is
 * no KNOWN_GAPS list any more: the number state machine is a faithful port, so ordinals, suffixed
 * decades, nominal digit runs, fractions and currency placement all reproduce. A documented gap is
 * still an uncertified scorer, and LibriSpeech contains every one of those constructs.
 *
 * A port that quietly agrees with its own author is the exact failure this exercise exists to avoid,
 * which is why expectations are generated from upstream rather than written here.
 */
import { describe, it, expect } from 'vitest';
import goldens from '../goldens.json';
import { normalizeOfficialTrackA } from '../officialNormalizer';
import { normalizeForTrack } from '../tracks';

interface GoldenCase { category: string; input: string; expected: string }
const CASES = (goldens as unknown as { cases: GoldenCase[] }).cases;

const norm = (s: string) => normalizeOfficialTrackA(s).join(' ');

describe('Track A reproduces the official oracle', () => {
    // EVERY vector, no filter. KNOWN_GAPS is gone: a documented gap is still an uncertified scorer,
    // and LibriSpeech contains ordinals, years and currency constructions, so a gap could move a ranking.
    it.each(CASES.map((c) => [c.category, c.input, c.expected] as const))(
        '[%s] %j', (_cat, input, expected) => { expect(norm(input)).toBe(expected); },
    );

    it('reproduces the oracle EXACTLY — all 68', () => {
        const passing = CASES.filter((c) => norm(c.input) === c.expected).length;
        expect(passing).toBe(CASES.length);
        expect(CASES.length).toBe(68);
    });
});

describe('the two tracks are genuinely different', () => {
    const withFillers = 'So um I think uh we should um review the plan today';

    it('TRACK A strips fillers — the official behaviour', () => {
        const a = normalizeForTrack('track_a', withFillers).tokens;
        expect(a).not.toContain('um');
        expect(a).not.toContain('uh');
    });

    it('TRACK B preserves them — this product measures disfluency', () => {
        const b = normalizeForTrack('track_b', withFillers).tokens;
        expect(b).toContain('um');
        expect(b).toContain('uh');
    });

    it('and they disagree on the SAME input, which is the whole point', () => {
        expect(normalizeForTrack('track_a', withFillers).tokens)
            .not.toEqual(normalizeForTrack('track_b', withFillers).tokens);
    });

    it('TRACK A strips bracketed markers; TRACK B keeps them', () => {
        expect(normalizeForTrack('track_a', 'the [inaudible] part').tokens).toEqual(['the', 'part']);
        expect(normalizeForTrack('track_b', 'the [inaudible] part').tokens).toContain('[inaudible]');
    });
});
