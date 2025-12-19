import { describe, it, expect } from 'vitest';
import {
    SUBSCRIPTION_TIERS,
    TIER_LIMITS,
    isPro,
    isFree,
    getTierLabel,
    getTierLimits,
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

        it('PRO limits have Infinity for unbounded values', () => {
            const proLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.PRO];
            expect(proLimits.monthlyMinutes).toBe(Infinity);
            expect(proLimits.maxSessionDuration).toBe(Infinity);
        });
    });

    describe('TIER_LIMITS', () => {
        it('FREE tier has correct limits', () => {
            const freeLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.FREE];
            expect(freeLimits.maxCustomWords).toBe(10);
            expect(freeLimits.monthlyMinutes).toBe(30);
            expect(freeLimits.maxSessionDuration).toBe(20);
        });

        it('PRO tier has higher limits', () => {
            const proLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.PRO];
            expect(proLimits.maxCustomWords).toBe(100);
            expect(proLimits.maxCustomWords).toBeGreaterThan(
                TIER_LIMITS[SUBSCRIPTION_TIERS.FREE].maxCustomWords
            );
        });
    });
});
