import { describe, it, expect } from 'vitest';
import { deriveFocusCoverage, markCoveredTokens, segmentTranscript } from '@/utils/focusCoverage';

const POINTS = ['Name the price', 'State the guarantee'];

describe('focusCoverage.deriveFocusCoverage', () => {
    it('is all-pending with 0/N before any words', () => {
        const c = deriveFocusCoverage(POINTS, '', 0);
        expect(c.total).toBe(2);
        expect(c.coveredCount).toBe(0);
        expect(c.nextIndex).toBe(0);
        expect(c.missedReason).toBeNull();
        expect(c.rows.every((r) => !r.covered)).toBe(true);
    });

    it('covers a point from real transcript text, with quote + timestamp', () => {
        const c = deriveFocusCoverage(POINTS, 'I will name the price now.', 20);
        expect(c.coveredCount).toBe(1);
        expect(c.rows[0].covered).toBe(true);
        expect(c.rows[0].quote).toContain('price');
        expect(c.rows[0].coveredAtSec).not.toBeNull();
        expect(c.rows[1].covered).toBe(false);
        expect(c.nextIndex).toBe(1);
    });

    it('names where the time went for the missed point', () => {
        const c = deriveFocusCoverage(POINTS, 'I will name the price now.', 84);
        expect(c.missedReason).toMatch(/the time went there/i);
        expect(c.missedReason).toMatch(/point 1/);
    });

    it('never un-ticks a latched point even if the transcript no longer matches', () => {
        const c = deriveFocusCoverage(POINTS, '', 0, new Set([0]));
        expect(c.rows[0].covered).toBe(true);
        expect(c.coveredCount).toBe(1);
    });
});

describe('focusCoverage.markCoveredTokens', () => {
    it('marks the tokens inside a covering phrase and clears any filler flag', () => {
        const tokens = [{ text: 'name' }, { text: 'the' }, { text: 'price' }, { text: 'um', filler: true }];
        const out = markCoveredTokens(tokens, ['name the price']);
        expect(out.slice(0, 3).every((t) => t.covered)).toBe(true);
        expect(out[3].covered).toBe(false);
        // Orange (filler) never competes with the coverage highlight.
        expect(out.every((t) => t.filler === false)).toBe(true);
    });

    it('marks nothing for an unmatched quote rather than guessing', () => {
        const tokens = [{ text: 'hello' }, { text: 'world' }];
        const out = markCoveredTokens(tokens, ['completely different phrase']);
        expect(out.every((t) => !t.covered)).toBe(true);
    });
});

describe('focusCoverage.segmentTranscript', () => {
    it('splits on sentence boundaries and assigns non-decreasing start seconds', () => {
        const segs = segmentTranscript('First point here. Second point there.', 60);
        expect(segs.length).toBe(2);
        expect(segs[0].startSec).toBe(0);
        expect(segs[1].startSec).toBeGreaterThanOrEqual(segs[0].startSec);
    });
});
