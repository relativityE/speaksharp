import { describe, it, expect } from 'vitest';
import { comparePace, PACE_LENGTH_RATIO, PACE_NORMAL_VARIATION_PERCENT, type PaceTake } from '../repeatPaceComparison';

const take = (over: Partial<PaceTake> = {}): PaceTake => ({
    product: 'open_mic', eligible: true, exclusionReasons: [], durationSeconds: 90, wpm: 150, cohortKey: 'private|v2|base|clarity_v1', ...over,
});

describe('Open Mic repeat pace comparison', () => {
    it('pins the provisional constants', () => {
        expect(PACE_NORMAL_VARIATION_PERCENT).toBe(10);
        expect(PACE_LENGTH_RATIO).toEqual({ MIN: 0.5, MAX: 2 });
    });

    it('compares two eligible Open Mic takes from the same setup', () => {
        expect(comparePace(take(), take({ wpm: 120 }))).toEqual({
            status: 'compared', beforeWpm: 150, afterWpm: 120, changePercent: -20, band: 'changed',
        });
        expect(comparePace(take(), take({ wpm: 180 }))).toMatchObject({ changePercent: 20, band: 'changed' });
    });

    it('a change under 10% is normal variation; exactly 10% counts as a change', () => {
        expect(comparePace(take(), take({ wpm: 138 }))).toMatchObject({ band: 'within_normal_variation' });
        expect(comparePace(take(), take({ wpm: 150 }))).toMatchObject({ changePercent: 0, band: 'within_normal_variation' });
        expect(comparePace(take({ wpm: 100 }), take({ wpm: 110 }))).toMatchObject({ band: 'changed' });
        expect(comparePace(take({ wpm: 100 }), take({ wpm: 90 }))).toMatchObject({ band: 'changed' });
    });

    it('not Open Mic: Focus Points, legacy (no marker), or mixed', () => {
        for (const [a, b] of [['focus_points', 'focus_points'], [null, 'open_mic'], ['open_mic', 'focus_points']] as const) {
            expect(comparePace(take({ product: a }), take({ product: b }))).toEqual({ status: 'cant_compare', reason: 'not_open_mic' });
        }
    });

    it('an ineligible take names its first stored reason; an engine-identity exclusion reads as a different setup', () => {
        expect(comparePace(take(), take({ eligible: false, exclusionReasons: ['too_short', 'too_few_words'] })))
            .toEqual({ status: 'cant_compare', reason: 'not_eligible', exclusionReason: 'too_short' });
        expect(comparePace(take({ eligible: false, exclusionReasons: ['no_transcript'] }), take()))
            .toEqual({ status: 'cant_compare', reason: 'not_eligible', exclusionReason: 'no_transcript' });
        expect(comparePace(take({ eligible: false, exclusionReasons: ['made_up'] }), take()))
            .toEqual({ status: 'cant_compare', reason: 'not_eligible', exclusionReason: 'unknown' });
        expect(comparePace(take(), take({ eligible: false, exclusionReasons: ['engine_not_comparable'] })))
            .toEqual({ status: 'cant_compare', reason: 'different_setup' });
    });

    it('a different engine, version or model (cohort) is not compared; a missing cohort is never equal', () => {
        expect(comparePace(take(), take({ cohortKey: 'private|v2|tiny|clarity_v1' }))).toEqual({ status: 'cant_compare', reason: 'different_setup' });
        expect(comparePace(take({ cohortKey: null }), take({ cohortKey: null }))).toEqual({ status: 'cant_compare', reason: 'different_setup' });
    });

    it('a missing, zero or non-finite pace is not compared', () => {
        for (const wpm of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(comparePace(take(), take({ wpm }))).toEqual({ status: 'cant_compare', reason: 'no_pace' });
        }
    });

    it('very different lengths (outside 0.5x-2x) are not compared; the bounds themselves are', () => {
        expect(comparePace(take({ durationSeconds: 90 }), take({ durationSeconds: 44 }))).toEqual({ status: 'cant_compare', reason: 'different_length' });
        expect(comparePace(take({ durationSeconds: 90 }), take({ durationSeconds: 181 }))).toEqual({ status: 'cant_compare', reason: 'different_length' });
        expect(comparePace(take({ durationSeconds: 90 }), take({ durationSeconds: 45 }))).toMatchObject({ status: 'compared' });
        expect(comparePace(take({ durationSeconds: 90 }), take({ durationSeconds: 180 }))).toMatchObject({ status: 'compared' });
        expect(comparePace(take({ durationSeconds: null }), take())).toEqual({ status: 'cant_compare', reason: 'different_length' });
    });

    it('a missing take is unavailable, never a comparison', () => {
        expect(comparePace(null, take())).toEqual({ status: 'unavailable' });
        expect(comparePace(take(), null)).toEqual({ status: 'unavailable' });
    });
});
