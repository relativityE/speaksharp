import { describe, it, expect } from 'vitest';
import {
    SUBSCRIPTION_TIERS,
    TIER_LIMITS,
    isPro,
    isFree,
    getEffectiveSubscriptionStatus,
    isExpiredPromoOnlyProfile,
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

    describe('effective promo tier', () => {
        it('treats expired promo-only Pro profiles as Free before usage refresh completes', () => {
            const profile = {
                subscription_status: 'pro',
                promo_expires_at: '2024-01-01T00:00:00.000Z',
            };

            expect(isExpiredPromoOnlyProfile(profile)).toBe(true);
            expect(getEffectiveSubscriptionStatus(null, profile)).toBe('free');
        });

        it('keeps paid Pro profiles Pro even with an old promo timestamp', () => {
            const profile = {
                subscription_status: 'pro',
                promo_expires_at: '2024-01-01T00:00:00.000Z',
                stripe_subscription_id: 'sub_paid',
            };

            expect(isExpiredPromoOnlyProfile(profile)).toBe(false);
            expect(getEffectiveSubscriptionStatus(null, profile)).toBe('pro');
        });

        it('lets usage-limit effective status override stale profile state', () => {
            const profile = {
                subscription_status: 'pro',
                promo_expires_at: '2999-01-01T00:00:00.000Z',
            };

            expect(getEffectiveSubscriptionStatus('free', profile)).toBe('free');
            expect(getEffectiveSubscriptionStatus('pro', { subscription_status: 'free' })).toBe('pro');
        });
    });

    describe('getTierLabel', () => {
        it('returns "Pro" for pro users', () => {
            expect(getTierLabel('pro')).toBe('Pro');
        });

        it('returns "Basic" for free users', () => {
            expect(getTierLabel('free')).toBe('Basic');
        });

        it('returns "Basic" for null/undefined', () => {
            expect(getTierLabel(null)).toBe('Basic');
            expect(getTierLabel(undefined)).toBe('Basic');
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
