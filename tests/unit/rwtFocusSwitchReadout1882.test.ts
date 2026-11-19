// @vitest-environment node
/**
 * #1882 (Sam, 17 Nov): the live Focus journey's switch readout must check the exact four Focus points, not just that a row
 * exists. The readout records only a count and this boolean; the labels never reach the receipt.
 */
import { describe, expect, it } from 'vitest';
import { railShowsExactFourPoints } from '../live/helpers/rwtOracles';

const points = ['Name the price', 'Give the timeline', 'Ask for the decision', 'Agree the next step'];

describe('#1882 railShowsExactFourPoints', () => {
    it('is true only for the same four labels in the same order', () => {
        expect(railShowsExactFourPoints([...points], points)).toBe(true);
    });

    it.each([
        ['no rows', []],
        ['one row (the old focus-point-0 check passed this)', [points[0]]],
        ['three rows', points.slice(0, 3)],
        ['a fifth row', [...points, 'Extra']],
        ['reordered', [points[1], points[0], points[2], points[3]]],
        ['a reworded label', [points[0], points[1], 'Ask for a decision', points[3]]],
        ['a row whose label could not be read', [points[0], null, points[2], points[3]]],
        ['an earlier set', ['Old one', 'Old two', 'Old three', 'Old four']],
    ])('is false for %s', (_label, labels) => {
        expect(railShowsExactFourPoints(labels as Array<string | null>, points)).toBe(false);
    });

    it('is false when the set itself is not four points, even if the rail matches it', () => {
        expect(railShowsExactFourPoints(points.slice(0, 3), points.slice(0, 3))).toBe(false);
    });
});
