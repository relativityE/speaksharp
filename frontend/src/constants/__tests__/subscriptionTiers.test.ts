import { describe, it, expect } from 'vitest';
import {
    SUBSCRIPTION_TIERS,
    TIER_LIMITS,
    isPro,
    isBasic,
    getEffectiveSubscriptionStatus,
    hasPaidProEntitlement,
    isActiveTrialProfile,
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

        it('returns false for "basic"', () => {
            expect(isPro('basic')).toBe(false);
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

    describe('isBasic', () => {
        it('returns true for "basic"', () => {
            expect(isBasic('basic')).toBe(true);
        });

        it('returns false for "pro"', () => {
            expect(isBasic('pro')).toBe(false);
        });

        it('returns false for null', () => {
            expect(isBasic(null)).toBe(false);
        });
    });

    describe('effective trial tier', () => {
        it('treats active trial profiles as Pro before usage refresh completes', () => {
            const profile = {
                subscription_status: 'basic',
                trial_expires_at: '2999-01-01T00:00:00.000Z',
            };

            expect(isActiveTrialProfile(profile)).toBe(true);
            expect(getEffectiveSubscriptionStatus(null, profile)).toBe('pro');
        });

        it('treats expired trial Basic profiles as Basic before usage refresh completes', () => {
            const profile = {
                subscription_status: 'basic',
                trial_expires_at: '2024-01-01T00:00:00.000Z',
            };

            expect(isActiveTrialProfile(profile)).toBe(false);
            expect(getEffectiveSubscriptionStatus(null, profile)).toBe('basic');
        });

        it('lets usage-limit effective status override stale profile state', () => {
            const profile = {
                subscription_status: 'basic',
                trial_expires_at: '2999-01-01T00:00:00.000Z',
            };

            expect(getEffectiveSubscriptionStatus('basic', profile)).toBe('basic');
            expect(getEffectiveSubscriptionStatus('pro', { subscription_status: 'basic' })).toBe('pro');
        });
    });

    describe('hasPaidProEntitlement', () => {
        it('does not treat active trial as paid Pro', () => {
            expect(hasPaidProEntitlement({
                subscription_status: 'basic',
                trial_expires_at: '2999-01-01T00:00:00.000Z',
            })).toBe(false);
        });

        it('requires Pro status plus a Stripe/subscription id', () => {
            expect(hasPaidProEntitlement({
                subscription_status: 'pro',
                stripe_subscription_id: 'sub_123',
            })).toBe(true);

            expect(hasPaidProEntitlement({
                subscription_status: 'pro',
            })).toBe(false);
        });
    });

    describe('getTierLabel', () => {
        it('returns "Pro" for pro users', () => {
            expect(getTierLabel('pro')).toBe('Pro');
        });

        it('returns "Basic" for basic users', () => {
            expect(getTierLabel('basic')).toBe('Basic');
        });

        it('returns "Basic" for null/undefined', () => {
            expect(getTierLabel(null)).toBe('Basic');
            expect(getTierLabel(undefined)).toBe('Basic');
        });
    });

    describe('getTierLimits', () => {
        it('returns BASIC limits for null', () => {
            const limits = getTierLimits(null);
            expect(limits).toBe(TIER_LIMITS[SUBSCRIPTION_TIERS.BASIC]);
        });

        it('returns BASIC limits for "basic"', () => {
            const limits = getTierLimits('basic');
            expect(limits).toBe(TIER_LIMITS[SUBSCRIPTION_TIERS.BASIC]);
        });

        it('returns PRO limits for "pro"', () => {
            const limits = getTierLimits('pro');
            expect(limits).toBe(TIER_LIMITS[SUBSCRIPTION_TIERS.PRO]);
        });

        it('Limits have Infinity where appropriate', () => {
            const proLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.PRO];
            expect(proLimits.dailySeconds).toBe(Infinity);
            expect(proLimits.maxSessionDuration).toBe(Infinity);

            const basicLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.BASIC];
            expect(basicLimits.maxSessionDuration).toBe(Infinity);
        });
    });

    describe('getters', () => {
        it('getDailyLimit returns correct values', () => {
            expect(getDailyLimit('basic')).toBe(3600);
            expect(getDailyLimit('pro')).toBe(Infinity);
        });

        it('getMaxFillerWords returns 100 for both', () => {
            expect(getMaxFillerWords('basic')).toBe(100);
            expect(getMaxFillerWords('pro')).toBe(100);
        });
    });

    describe('TIER_LIMITS', () => {
        it('BASIC tier has correct alpha launch limits', () => {
            const basicLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.BASIC];
            expect(basicLimits.maxCustomWords).toBe(100);
            expect(basicLimits.dailySeconds).toBe(3600);
            expect(basicLimits.maxSessionDuration).toBe(Infinity);
        });

        it('PRO tier has correct alpha launch limits', () => {
            const proLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.PRO];
            expect(proLimits.maxCustomWords).toBe(100);
            expect(proLimits.dailySeconds).toBe(Infinity);
        });
    });
});
