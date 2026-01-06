import { describe, it, expect } from 'vitest';
import {
    SUBSCRIPTION_TIERS,
    TIER_LIMITS,
    isPro,
    isFree,
    getTierLabel,
    getTierLimits,
    getDailyLimit,
    getMaxFillerWords,
} from '../subscriptionTiers';

describe('subscriptionTiers', () => {
    describe('isPro', () => {
        it('returns true for "pro"', () => {
            expect(isPro('pro')).toBe(true);
        });

        it('returns false for "free"', () => {
            expect(isPro('free')).toBe(false);
        });

        it('returns false for null', () => {
            expect(isPro(null)).toBe(false);
        });

        it('returns false for undefined', () => {
            expect(isPro(undefined)).toBe(false);
        });

        it('returns false for empty string', () => {
            expect(isPro('')).toBe(false);
        });
    });

    describe('isFree', () => {
        it('returns true for "free"', () => {
            expect(isFree('free')).toBe(true);
        });

        it('returns false for "pro"', () => {
            expect(isFree('pro')).toBe(false);
        });

        it('returns false for null', () => {
            expect(isFree(null)).toBe(false);
        });
    });

    describe('getTierLabel', () => {
        it('returns "Pro" for pro users', () => {
            expect(getTierLabel('pro')).toBe('Pro');
        });

        it('returns "Free" for free users', () => {
            expect(getTierLabel('free')).toBe('Free');
        });

        it('returns "Free" for null/undefined', () => {
            expect(getTierLabel(null)).toBe('Free');
            expect(getTierLabel(undefined)).toBe('Free');
        });
    });

    describe('getTierLimits', () => {
        it('returns FREE limits for null', () => {
            const limits = getTierLimits(null);
            expect(limits).toBe(TIER_LIMITS[SUBSCRIPTION_TIERS.FREE]);
        });

        it('returns FREE limits for "free"', () => {
            const limits = getTierLimits('free');
            expect(limits).toBe(TIER_LIMITS[SUBSCRIPTION_TIERS.FREE]);
        });

        it('returns PRO limits for "pro"', () => {
            const limits = getTierLimits('pro');
            expect(limits).toBe(TIER_LIMITS[SUBSCRIPTION_TIERS.PRO]);
        });

        it('Limits have Infinity where appropriate', () => {
            const proLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.PRO];
            expect(proLimits.dailySeconds).toBe(Infinity);
            expect(proLimits.maxSessionDuration).toBe(Infinity);

            const freeLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.FREE];
            expect(freeLimits.maxSessionDuration).toBe(Infinity);
        });
    });

    describe('getters', () => {
        it('getDailyLimit returns correct values', () => {
            expect(getDailyLimit('free')).toBe(3600);
            expect(getDailyLimit('pro')).toBe(Infinity);
        });

        it('getMaxFillerWords returns 100 for both', () => {
            expect(getMaxFillerWords('free')).toBe(100);
            expect(getMaxFillerWords('pro')).toBe(100);
        });
    });

    describe('TIER_LIMITS', () => {
        it('FREE tier has correct alpha launch limits', () => {
            const freeLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.FREE];
            expect(freeLimits.maxCustomWords).toBe(100);
            expect(freeLimits.dailySeconds).toBe(3600);
            expect(freeLimits.maxSessionDuration).toBe(Infinity);
        });

        it('PRO tier has correct alpha launch limits', () => {
            const proLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.PRO];
            expect(proLimits.maxCustomWords).toBe(100);
            expect(proLimits.dailySeconds).toBe(Infinity);
        });
    });
});
