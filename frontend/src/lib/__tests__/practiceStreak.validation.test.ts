import { describe, it, expect } from 'vitest';
import { toPracticeStreak, STREAK_UNAVAILABLE, type PracticeStreak } from '../storage';

describe('toPracticeStreak — fails CLOSED on any inconsistent RPC payload (#1093)', () => {
    it('accepts only well-formed, state/count-CONSISTENT payloads', () => {
        expect(toPracticeStreak({ state: 'active', count: 1, timezone: 'UTC', lastQualifyingDate: '2026-07-30' }))
            .toEqual({ state: 'active', count: 1, timezone: 'UTC', lastQualifyingDate: '2026-07-30' });
        expect(toPracticeStreak({ state: 'active', count: 5, timezone: null, lastQualifyingDate: null }))
            .toEqual({ state: 'active', count: 5, timezone: null, lastQualifyingDate: null });
        expect(toPracticeStreak({ state: 'none', count: 0, timezone: 'UTC', lastQualifyingDate: null }))
            .toEqual({ state: 'none', count: 0, timezone: 'UTC', lastQualifyingDate: null });
        expect(toPracticeStreak({ state: 'unavailable', count: 0, timezone: null, lastQualifyingDate: null }))
            .toEqual({ state: 'unavailable', count: 0, timezone: null, lastQualifyingDate: null });
    });

    it.each([
        ['null', null],
        ['string', 'nope'],
        ['unknown state', { state: 'weird', count: 3 }],
        ['active-zero', { state: 'active', count: 0 }],
        ['active-negative', { state: 'active', count: -2 }],
        ['active-fractional', { state: 'active', count: 3.5 }],
        ['active-nonnumeric', { state: 'active', count: '4' }],
        ['active-NaN', { state: 'active', count: Number.NaN }],
        ['none-with-positive-count', { state: 'none', count: 4 }],
        ['unavailable-with-positive-count', { state: 'unavailable', count: 1 }],
        ['missing count', { state: 'active' }],
        ['missing state', { count: 3 }],
    ])('rejects %s -> STREAK_UNAVAILABLE', (_label, payload) => {
        expect(toPracticeStreak(payload as unknown)).toEqual(STREAK_UNAVAILABLE);
    });

    it('STREAK_UNAVAILABLE is the canonical fail-closed shape', () => {
        expect(STREAK_UNAVAILABLE).toEqual({ state: 'unavailable', count: 0, lastQualifyingDate: null, timezone: null } as PracticeStreak);
    });
});
