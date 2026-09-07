import { describe, it, expect } from 'vitest';
import { applyFinalizedCoverageAuthority, deriveFocusCoverage, markCoveredTokens, segmentTranscript } from '@/utils/focusCoverage';

const POINTS = ['Name the price', 'State the guarantee'];

describe('focusCoverage.deriveFocusCoverage', () => {
    it('is all-pending with 0/N before any words', () => {
        const c = deriveFocusCoverage(POINTS, '', 0);
        expect(c.total).toBe(2);
        expect(c.coveredCount).toBe(0);
        expect(c.nextIndex).toBe(0);
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

    it('leaves an unmatched point uncovered (reported as "Not detected" by the rail, no time-speculation)', () => {
        const c = deriveFocusCoverage(POINTS, 'I will name the price now.', 84);
        expect(c.coveredCount).toBe(1);
        expect(c.rows[1].covered).toBe(false);
        // The util no longer fabricates a "where the time went" reason (removed for truthfulness).
        expect('missedReason' in c).toBe(false);
    });

    it('never un-ticks a latched point even if the transcript no longer matches', () => {
        const c = deriveFocusCoverage(POINTS, '', 0, new Set([0]));
        expect(c.rows[0].covered).toBe(true);
        expect(c.coveredCount).toBe(1);
    });
});

describe('focusCoverage.applyFinalizedCoverageAuthority — terminal truth', () => {
    it('uses the stop-seam verdict when the weaker flattened-text matcher disagrees', () => {
        const derived = deriveFocusCoverage(POINTS, 'I discussed warranty terms.', 60);
        expect(derived.coveredCount).toBe(0);

        const terminal = applyFinalizedCoverageAuthority(derived, POINTS, [
            { id: 'brief-point-1', label: POINTS[0], status: 'missing' },
            { id: 'brief-point-2', label: POINTS[1], status: 'covered' },
        ]);

        expect(terminal?.coveredCount).toBe(1);
        expect(terminal?.rows[1]).toMatchObject({ status: 'covered', covered: true, quote: null });
    });

    it('counts a partial terminal match as detected while preserving the partial status', () => {
        const derived = deriveFocusCoverage(POINTS, 'Unrelated retained words.', 60);
        const terminal = applyFinalizedCoverageAuthority(derived, POINTS, [
            { id: 'brief-point-1', label: POINTS[0], status: 'partial' },
            { id: 'brief-point-2', label: POINTS[1], status: 'missing' },
        ]);

        expect(terminal?.coveredCount).toBe(1);
        expect(terminal?.rows[0]).toMatchObject({ status: 'partial', covered: true });
    });

    it('never attributes a weaker matcher quote or timestamp to a status-only terminal verdict', () => {
        const derived = deriveFocusCoverage(POINTS, 'I will name the price now.', 60);
        expect(derived.rows[0].quote).not.toBeNull();
        const terminal = applyFinalizedCoverageAuthority(derived, POINTS, [
            { id: 'brief-point-1', label: POINTS[0], status: 'covered' },
            { id: 'brief-point-2', label: POINTS[1], status: 'missing' },
        ]);

        expect(terminal?.rows[0]).toMatchObject({ status: 'covered', covered: true, quote: null, coveredAtSec: null });
        expect(terminal?.coveredQuotes).toEqual([]);
    });

    it.each([
        ['missing', null],
        ['short', [{ id: 'brief-point-1', label: POINTS[0], status: 'covered' as const }]],
        ['wrong brief', [
            { id: 'brief-point-1', label: 'Different point', status: 'covered' as const },
            { id: 'brief-point-2', label: POINTS[1], status: 'missing' as const },
        ]],
    ])('refuses a %s terminal authority instead of manufacturing a verdict', (_label, authority) => {
        const derived = deriveFocusCoverage(POINTS, 'I will name the price now.', 60);
        expect(applyFinalizedCoverageAuthority(derived, POINTS, authority)).toBeNull();
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
