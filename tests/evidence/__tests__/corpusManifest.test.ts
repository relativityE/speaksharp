/**
 * #1304 Task 4 — the frozen subset must actually be frozen.
 *
 * An unfrozen random subset makes two runs incomparable: a model could "improve" purely by drawing
 * easier clips. These pin the properties the freeze depends on, so a change to the sampler is a test
 * failure rather than a silently different corpus.
 *
 * The PRNG is inline and dependency-free. `seedrandom` is in neither package.json, and adding a
 * package to pick 300 numbers is supply-chain surface for no benefit — but an inline PRNG is only
 * trustworthy if its determinism is asserted, which is what this file is for.
 */
import { describe, it, expect } from 'vitest';
import { seededSample } from '../../../scripts/corpus/make-corpus-manifest.mjs';

const SEED = 'speaksharp-1304-v1';
const POOL = Array.from({ length: 2620 }, (_, i) => `utt-${String(i).padStart(4, '0')}`);

describe('the seeded subset is deterministic and order-independent', () => {
    it('the same seed selects the same ids, every time', () => {
        expect(seededSample(POOL, 300, SEED)).toEqual(seededSample(POOL, 300, SEED));
    });

    it('INPUT ORDER cannot change the selection', () => {
        // Directory traversal order is filesystem-dependent. Sorting before sampling is what makes the
        // manifest reproducible on a different machine — without it, the "frozen" subset would drift.
        expect(seededSample([...POOL].reverse(), 300, SEED)).toEqual(seededSample(POOL, 300, SEED));
        expect(seededSample([...POOL].sort(() => 0.5 - Math.random()), 300, SEED))
            .toEqual(seededSample(POOL, 300, SEED));
    });

    it('a DIFFERENT seed selects a different subset — the seed is doing work', () => {
        // Positive control: without this, a broken sampler returning the first 300 would pass every
        // other assertion here.
        expect(seededSample(POOL, 300, 'some-other-seed')).not.toEqual(seededSample(POOL, 300, SEED));
    });

    it('selects exactly the requested count, and never duplicates', () => {
        const picked = seededSample(POOL, 300, SEED);
        expect(picked).toHaveLength(300);
        expect(new Set(picked).size).toBe(300);
    });

    it('is a genuine sample, not a prefix', () => {
        const picked = seededSample(POOL, 300, SEED);
        expect(picked).not.toEqual(POOL.slice(0, 300).sort());
        // It should reach across the whole pool rather than clustering at one end.
        const last = picked[picked.length - 1];
        expect(Number(last.slice(4))).toBeGreaterThan(2000);
    });

    it('a pool smaller than the subset size returns everything, not a crash', () => {
        const small = POOL.slice(0, 12);
        expect(seededSample(small, 300, SEED)).toEqual([...small].sort());
    });

    it('the output is sorted, so a manifest diff is readable', () => {
        const picked = seededSample(POOL, 300, SEED);
        expect(picked).toEqual([...picked].sort());
    });
});
