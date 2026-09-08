import { describe, it, expect } from 'vitest';
import { deriveFocusCoverage, markCoveredTokens, segmentTranscript } from '@/utils/focusCoverage';

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
 * #1429 E — the PRIMARY Focus Points journey.
 *
 * The human journey enters a user-selected number of points, speaks EVERY entered point, and
 * requires every entered point to be detected. An earlier corpus statement that one point is
 * deliberately left unspoken described the NEGATIVE case only; it never described the primary
 * journey, and a suite that only ever proves N-1 of N cannot tell "honest miss" apart from
 * "cannot detect the last point at this set size".
 *
 * The negative complement lives in the second block below and in
 * `tests/e2e/focus-points-open-mic-isolation.e2e.spec.ts`, which leaves one point unspoken so a
 * real "Not detected" row must render.
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
        it(`detects ${total}/${total} when the speaker covers every entered point`, () => {
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

    for (const total of [3, 4, 7] as const) {
        it(`NEGATIVE: at ${total} points, the one unspoken point — and only it — reports not detected`, () => {
            const points = SEVEN_POINTS.slice(0, total);
            const omitted = total - 1;
            const transcript = SPOKEN_FOR_POINT.slice(0, total)
                .filter((_, index) => index !== omitted)
                .join(' ');

            const coverage = deriveFocusCoverage(points, transcript, 120);

            expect(coverage.rows[omitted].covered).toBe(false);
            expect(coverage.rows[omitted].coveredAtSec).toBeNull();
            expect(coverage.rows.filter((row) => !row.covered).map((row) => row.label))
                .toEqual([points[omitted]]);
            expect(coverage.coveredCount).toBe(total - 1);
        });
    }
});
