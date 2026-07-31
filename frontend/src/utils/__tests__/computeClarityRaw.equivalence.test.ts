import { describe, it, expect } from 'vitest';
import { calculateClarityScore, computeClarityRaw, ANALYTICS_THRESHOLDS } from '../sessionAnalysis';

/**
 * #1045 PR-A — equivalence gate.
 *
 * `PROGRESS_AND_NEXT_ACTION.md` §5 requires an unrounded clear-delivery value for Progress evidence,
 * AND that every existing display stays byte-identical. That is only credible if it is proven, so this
 * suite asserts `Math.round(computeClarityRaw(x)) === calculateClarityScore(x)` across boundaries,
 * representative cases, and a wide deterministic sweep.
 *
 * If this suite ever fails, the refactor changed a user-visible number and must be reverted — the raw
 * value exists to add precision for Progress, never to move what users already see.
 */

type Input = { wordCount: number; fillerCount: number; errorCount: number; wpm: number };
const both = (i: Input) => ({ raw: computeClarityRaw(i), rounded: calculateClarityScore(i) });

const T = ANALYTICS_THRESHOLDS;

describe('#1045 computeClarityRaw ↔ calculateClarityScore equivalence', () => {
    it('rounding the raw value reproduces the shipped score for representative sessions', () => {
        const cases: Input[] = [
            { wordCount: 100, fillerCount: 0, errorCount: 0, wpm: 140 },   // clean, ideal pace
            { wordCount: 100, fillerCount: 5, errorCount: 0, wpm: 140 },   // some fillers
            { wordCount: 250, fillerCount: 12, errorCount: 2, wpm: 155 },
            { wordCount: 612, fillerCount: 18, errorCount: 0, wpm: 132 },
            { wordCount: 75, fillerCount: 9, errorCount: 4, wpm: 200 },    // fast + errors
            { wordCount: 80, fillerCount: 1, errorCount: 0, wpm: 60 },     // very slow
        ];
        for (const c of cases) {
            const { raw, rounded } = both(c);
            expect(Math.round(raw), JSON.stringify(c)).toBe(rounded);
        }
    });

    it('holds at every threshold boundary (the places a refactor is most likely to drift)', () => {
        const wpms = [
            0, 1,
            T.VERY_SLOW_WPM - 1, T.VERY_SLOW_WPM, T.VERY_SLOW_WPM + 1,
            T.TARGET_WPM_MIN, T.TARGET_WPM_MAX,
            T.FAST_WPM - 1, T.FAST_WPM, T.FAST_WPM + 1,
            300, 1000,
        ];
        for (const wpm of wpms) {
            for (const fillerCount of [0, 1, 7, 50]) {
                for (const errorCount of [0, 1, 9]) {
                    const c = { wordCount: 120, fillerCount, errorCount, wpm };
                    expect(Math.round(computeClarityRaw(c)), JSON.stringify(c)).toBe(calculateClarityScore(c));
                }
            }
        }
    });

    it('holds where the clamps bite — floor at 0 and ceiling at 100', () => {
        const floorCase = { wordCount: 10, fillerCount: 10, errorCount: 40, wpm: 400 };
        expect(computeClarityRaw(floorCase)).toBe(0);
        expect(calculateClarityScore(floorCase)).toBe(0);

        const ceilingCase = { wordCount: 500, fillerCount: 0, errorCount: 0, wpm: 140 };
        expect(computeClarityRaw(ceilingCase)).toBe(100);
        expect(calculateClarityScore(ceilingCase)).toBe(100);
    });

    it('preserves the wordCount <= 0 short-circuit exactly', () => {
        for (const wordCount of [0, -1, -100]) {
            const c = { wordCount, fillerCount: 3, errorCount: 1, wpm: 140 };
            expect(computeClarityRaw(c)).toBe(0);
            expect(calculateClarityScore(c)).toBe(0);
        }
    });

    it('holds across a deterministic sweep (no random input — a failure must be reproducible)', () => {
        let checked = 0;
        for (let wordCount = 5; wordCount <= 605; wordCount += 100) {
            for (let fillerCount = 0; fillerCount <= 30; fillerCount += 7) {
                for (let errorCount = 0; errorCount <= 6; errorCount += 3) {
                    for (let wpm = 0; wpm <= 260; wpm += 13) {
                        const c = { wordCount, fillerCount, errorCount, wpm };
                        expect(Math.round(computeClarityRaw(c)), JSON.stringify(c)).toBe(calculateClarityScore(c));
                        checked++;
                    }
                }
            }
        }
        expect(checked).toBeGreaterThan(1000);
    });

    it('the raw value carries precision the rounded score discards (the reason it exists)', () => {
        // A case whose exact value is fractional: rounding loses sub-point movement that Progress needs.
        const c = { wordCount: 137, fillerCount: 5, errorCount: 1, wpm: 145 };
        const raw = computeClarityRaw(c);
        expect(Number.isInteger(raw)).toBe(false);
        expect(Math.round(raw)).toBe(calculateClarityScore(c));
    });

    it('is clamped to [0,100] for every swept input', () => {
        for (let wpm = 0; wpm <= 400; wpm += 37) {
            for (const fillerCount of [0, 25, 200]) {
                const raw = computeClarityRaw({ wordCount: 90, fillerCount, errorCount: 3, wpm });
                expect(raw).toBeGreaterThanOrEqual(0);
                expect(raw).toBeLessThanOrEqual(100);
            }
        }
    });
});
