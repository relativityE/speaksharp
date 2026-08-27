/**
 * #1304 — Track A verified against the GENERATED goldens, and its gaps named out loud.
 *
 * The goldens come from running the real `EnglishTextNormalizer` at a pinned upstream commit. Every
 * case is asserted. Cases this port does not yet reproduce are listed in KNOWN_GAPS with the reason —
 * an explicit, reviewable list, never a skip and never a loosened assertion. A port that quietly
 * agrees with its own author is the exact failure this exercise exists to avoid.
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
