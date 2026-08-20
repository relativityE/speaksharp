import { describe, it, expect } from 'vitest';
import { calculateClarityScore, computeClarityRaw, ANALYTICS_THRESHOLDS } from '../sessionAnalysis';

/**
 * #1045 PR-A — equivalence gate against a FROZEN LEGACY ORACLE.
 *
 * `PROGRESS_AND_NEXT_ACTION.md` §5 requires an unrounded clear-delivery value for Progress evidence AND
 * that every existing display stays byte-identical.
 *
 * WHY AN ORACLE, NOT A SELF-COMPARISON: the obvious assertion —
 * `Math.round(computeClarityRaw(x)) === calculateClarityScore(x)` — is CIRCULAR, because after the
 * refactor `calculateClarityScore` *is* `Math.round(computeClarityRaw(...))`. Both sides call the same
 * new code, so it would pass even if the refactor silently changed the legacy formula.
 *
 * `legacyClarityScore` below is a verbatim, independent transcription of the pre-refactor
 * implementation, with its threshold constants HARD-CODED rather than imported, so it cannot drift when
 * production code or `ANALYTICS_THRESHOLDS` change. BOTH the shipped rounded function and the new raw
 * function are compared against it.
 *
 * If this suite fails, the refactor moved a user-visible number and must be reverted.
 */

type Input = { wordCount: number; fillerCount: number; errorCount: number; wpm: number };

/** Frozen copy of the shipped constants at the time of the refactor. Intentionally NOT imported. */
const LEGACY = {
    FAST_WPM: 170,
    VERY_SLOW_WPM: 90,
    FAST_PACE_MAX_CLARITY_PENALTY: 20,
    SLOW_PACE_MAX_CLARITY_PENALTY: 15,
    FILLER_CLARITY_PENALTY_PER_PERCENT: 1.5,
    ERROR_MARKER_CLARITY_PENALTY: 3,
} as const;

/**
 * Verbatim transcription of `calculateClarityScore` as it existed BEFORE this PR. Do not refactor this
 * to share code with production — its independence is the entire point of the gate.
 */
function legacyClarityScore({ wordCount, fillerCount, errorCount, wpm }: Input): number {
    if (wordCount <= 0) return 0;

    const fillerPercentage = (fillerCount / wordCount) * 100;
    const pacePenalty =
        wpm > LEGACY.FAST_WPM
            ? Math.min(LEGACY.FAST_PACE_MAX_CLARITY_PENALTY, (wpm - LEGACY.FAST_WPM) / 3)
            : wpm > 0 && wpm < LEGACY.VERY_SLOW_WPM
                ? Math.min(LEGACY.SLOW_PACE_MAX_CLARITY_PENALTY, (LEGACY.VERY_SLOW_WPM - wpm) / 3)
                : 0;

    return Math.max(0, Math.min(100, Math.round(
        100
        - (fillerPercentage * LEGACY.FILLER_CLARITY_PENALTY_PER_PERCENT)
        - (errorCount * LEGACY.ERROR_MARKER_CLARITY_PENALTY)
        - pacePenalty,
    )));
}

/** Both production paths must equal the frozen oracle — this is what makes the gate non-circular. */
function expectMatchesLegacy(c: Input) {
    const expected = legacyClarityScore(c);
    expect(calculateClarityScore(c), `shipped score drifted: ${JSON.stringify(c)}`).toBe(expected);
    expect(Math.round(computeClarityRaw(c)), `raw→rounded drifted: ${JSON.stringify(c)}`).toBe(expected);
}

const T = ANALYTICS_THRESHOLDS;

describe('#1045 clear-delivery refactor vs FROZEN legacy oracle', () => {
    it('the frozen oracle uses the same constants the app ships (catches a silent threshold change)', () => {
        expect(T.FAST_WPM).toBe(LEGACY.FAST_WPM);
        expect(T.VERY_SLOW_WPM).toBe(LEGACY.VERY_SLOW_WPM);
        expect(T.FAST_PACE_MAX_CLARITY_PENALTY).toBe(LEGACY.FAST_PACE_MAX_CLARITY_PENALTY);
        expect(T.SLOW_PACE_MAX_CLARITY_PENALTY).toBe(LEGACY.SLOW_PACE_MAX_CLARITY_PENALTY);
        expect(T.FILLER_CLARITY_PENALTY_PER_PERCENT).toBe(LEGACY.FILLER_CLARITY_PENALTY_PER_PERCENT);
        expect(T.ERROR_MARKER_CLARITY_PENALTY).toBe(LEGACY.ERROR_MARKER_CLARITY_PENALTY);
    });

    it('golden values — explicit expected numbers, independent of any implementation', () => {
        // 100 words, 5 fillers (5%), no errors, ideal pace → 100 − 5×1.5 = 92.5 → 93
        expect(calculateClarityScore({ wordCount: 100, fillerCount: 5, errorCount: 0, wpm: 140 })).toBe(93);
        expect(computeClarityRaw({ wordCount: 100, fillerCount: 5, errorCount: 0, wpm: 140 })).toBeCloseTo(92.5, 10);
        // 100 words, 0 fillers, 2 error markers → 100 − 6 = 94
        expect(calculateClarityScore({ wordCount: 100, fillerCount: 0, errorCount: 2, wpm: 140 })).toBe(94);
        // 200 wpm → fast penalty min(20, (200−170)/3 = 10) → 90
        expect(calculateClarityScore({ wordCount: 100, fillerCount: 0, errorCount: 0, wpm: 200 })).toBe(90);
        // 60 wpm → slow penalty min(15, (90−60)/3 = 10) → 90
        expect(calculateClarityScore({ wordCount: 100, fillerCount: 0, errorCount: 0, wpm: 60 })).toBe(90);
    });

    it('representative sessions match the legacy oracle', () => {
        const cases: Input[] = [
            { wordCount: 100, fillerCount: 0, errorCount: 0, wpm: 140 },
            { wordCount: 100, fillerCount: 5, errorCount: 0, wpm: 140 },
            { wordCount: 250, fillerCount: 12, errorCount: 2, wpm: 155 },
            { wordCount: 612, fillerCount: 18, errorCount: 0, wpm: 132 },
            { wordCount: 75, fillerCount: 9, errorCount: 4, wpm: 200 },
            { wordCount: 80, fillerCount: 1, errorCount: 0, wpm: 60 },
        ];
        // Direct assertion in the test body (the helper's expects are not visible to vitest/expect-expect).
        expect(cases.length).toBe(6);
        cases.forEach(expectMatchesLegacy);
    });

    it('matches at ±1 around EVERY threshold, including TARGET_WPM_MIN and TARGET_WPM_MAX', () => {
        const around = (n: number) => [n - 1, n, n + 1];
        const wpms = [
            0, 1,
            ...around(T.VERY_SLOW_WPM),
            ...around(T.TARGET_WPM_MIN),
            ...around(T.TARGET_WPM_MAX),
            ...around(T.FAST_WPM),
            300, 1000,
        ];
        // Direct assertion in the test body, and a guard that the boundary set really is ±1 around each
        // threshold rather than only their exact values.
        expect(wpms).toEqual(expect.arrayContaining([
            T.TARGET_WPM_MIN - 1, T.TARGET_WPM_MIN, T.TARGET_WPM_MIN + 1,
            T.TARGET_WPM_MAX - 1, T.TARGET_WPM_MAX, T.TARGET_WPM_MAX + 1,
        ]));
        for (const wpm of wpms) {
            for (const fillerCount of [0, 1, 7, 50]) {
                for (const errorCount of [0, 1, 9]) {
                    expectMatchesLegacy({ wordCount: 120, fillerCount, errorCount, wpm });
                }
            }
        }
    });

    it('matches where the clamps bite — floor 0 and ceiling 100', () => {
        const floorCase = { wordCount: 10, fillerCount: 10, errorCount: 40, wpm: 400 };
        expectMatchesLegacy(floorCase);
        expect(computeClarityRaw(floorCase)).toBe(0);

        const ceilingCase = { wordCount: 500, fillerCount: 0, errorCount: 0, wpm: 140 };
        expectMatchesLegacy(ceilingCase);
        expect(computeClarityRaw(ceilingCase)).toBe(100);
    });

    it('preserves the wordCount <= 0 short-circuit exactly', () => {
        for (const wordCount of [0, -1, -100]) {
            const c = { wordCount, fillerCount: 3, errorCount: 1, wpm: 140 };
            expectMatchesLegacy(c);
            expect(computeClarityRaw(c)).toBe(0);
        }
    });

    it('matches across a deterministic sweep (no random input — a failure must be reproducible)', () => {
        let checked = 0;
        for (let wordCount = 5; wordCount <= 605; wordCount += 100) {
            for (let fillerCount = 0; fillerCount <= 30; fillerCount += 7) {
                for (let errorCount = 0; errorCount <= 6; errorCount += 3) {
                    for (let wpm = 0; wpm <= 260; wpm += 13) {
                        expectMatchesLegacy({ wordCount, fillerCount, errorCount, wpm });
                        checked++;
                    }
                }
            }
        }
        expect(checked).toBeGreaterThan(1000);
    });

    it('the raw value preserves sub-point evidence the rounded score discards', () => {
        // Whether such a difference is SHOWN as movement is the meaningful-movement product policy —
        // a calculable difference is not automatically meaningful user progress.
        const c = { wordCount: 137, fillerCount: 5, errorCount: 1, wpm: 145 };
        const raw = computeClarityRaw(c);
        expect(Number.isInteger(raw)).toBe(false);
        expect(Math.round(raw)).toBe(legacyClarityScore(c));
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
