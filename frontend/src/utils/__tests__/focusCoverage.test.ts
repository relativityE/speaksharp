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

    it('counts a live partial exactly as the terminal authority does without promoting it to full', () => {
        // The matcher exposes partial as a real status; discover a deterministic sample rather than
        // duplicating its private ratio in this presentation test.
        const candidates = ['name price', 'price', 'name the amount', 'state guarantee', 'guarantee'];
        const live = candidates.map((text) => deriveFocusCoverage(POINTS, text, 20))
            .find((result) => result.rows.some((row) => row.status === 'partial'));
        expect(live, 'fixture must exercise the live partial boundary').toBeDefined();
        const index = live?.rows.findIndex((row) => row.status === 'partial') ?? -1;
        expect(live?.rows[index]).toMatchObject({ status: 'partial', covered: true });
        expect(live?.coveredCount).toBe(live?.rows.filter((row) => row.status !== 'missing').length);

        const authority = POINTS.map((label, rowIndex) => ({
            id: `brief-point-${rowIndex + 1}`,
            label,
            status: rowIndex === index ? 'partial' as const : 'missing' as const,
        }));
        const terminal = applyFinalizedCoverageAuthority(live!, POINTS, authority);
        expect(terminal?.coveredCount).toBe(live?.coveredCount);
        expect(terminal?.rows[index]).toMatchObject({ status: 'partial', covered: true });
    });

    it('leaves an unmatched point uncovered (reported as "Not detected" by the rail, no time-speculation)', () => {
        const c = deriveFocusCoverage(POINTS, 'I will name the price now.', 84);
        expect(c.coveredCount).toBe(1);
        expect(c.rows[1].covered).toBe(false);
        // The util no longer fabricates a "where the time went" reason (removed for truthfulness).
        expect('missedReason' in c).toBe(false);
    });

    it('preserves the strongest live status without promoting partial evidence', () => {
        const partial = deriveFocusCoverage(POINTS, '', 0, new Map([[0, {
            label: POINTS[0], status: 'partial', covered: true, coveredAtSec: 4, quote: 'price',
        }]]));
        expect(partial.rows[0]).toMatchObject({ status: 'partial', covered: true, coveredAtSec: 4 });
        expect(partial.coveredCount).toBe(1);

        const covered = deriveFocusCoverage(POINTS, '', 0, new Map([[0, {
            label: POINTS[0], status: 'covered', covered: true, coveredAtSec: 6, quote: 'name the price',
        }]]));
        expect(covered.rows[0]).toMatchObject({ status: 'covered', covered: true, coveredAtSec: 6 });
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

/**
 * #1429 E — the Focus Points journey.
 *
 * THE REQUIREMENT: the user may enter ANY number of Focus Points, and every point they enter is
 * captured and detected. There is no criteria count, no default the product prefers, and no case in
 * which a point the user entered may go missing.
 *
 * The sizes below are sampled across the input range to show the behaviour does not depend on how
 * many points were entered. They are NOT a specification that those counts are special.
 */
const SEVEN_POINTS = [
    'Name the price',
    'State the guarantee',
    'Cover the timeline',
    'Explain the onboarding',
    'Mention the support team',
    'Describe the migration plan',
    'Confirm the renewal terms',
] as const;

const SPOKEN_FOR_POINT = [
    'First I will name the price clearly.',
    'Then I state the guarantee we offer.',
    'Next I cover the timeline for delivery.',
    'After that I explain the onboarding steps.',
    'I also mention the support team you get.',
    'Let me describe the migration plan in detail.',
    'Finally I confirm the renewal terms with you.',
] as const;

describe('focusCoverage — every entered point is preserved and detected (#1429 E)', () => {
    for (const total of [1, 3, 4, 7] as const) {
        it(`captures and detects all ${total} entered points — the count is the user's choice`, () => {
            const points = SEVEN_POINTS.slice(0, total);
            const transcript = SPOKEN_FOR_POINT.slice(0, total).join(' ');

            const coverage = deriveFocusCoverage(points, transcript, 120);

            expect(coverage.total).toBe(total);
            expect(coverage.rows).toHaveLength(total);
            // Named per row so a partial pass reports WHICH entered point went undetected.
            expect(coverage.rows.filter((row) => !row.covered).map((row) => row.label)).toEqual([]);
            expect(coverage.coveredCount).toBe(total);
        });
    }

    it('CASUALTY: a set that silently drops entered points cannot pass the all-detected contract', () => {
        // Four entered, only the first three reach the deriver — the defect Focus Points shipped
        // with (UI reported 1/4 while the transcript contained the covered material).
        const coverage = deriveFocusCoverage(SEVEN_POINTS.slice(0, 3), SPOKEN_FOR_POINT.slice(0, 4).join(' '), 120);

        expect(coverage.total).toBe(3);
        expect(coverage.total).not.toBe(4);
    });

});
