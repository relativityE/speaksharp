import { describe, it, expect } from 'vitest';
import {
    SUBSCRIPTION_TIERS,
    TIER_LIMITS,
    isPro,
    isBasic,
    isFree,
	    getEffectiveSubscriptionStatus,
	    hasCloudSttEntitlement,
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

    describe('isFree', () => {
        it('returns true for "free" and unknown empty statuses', () => {
            expect(isFree('free')).toBe(true);
            expect(isFree(null)).toBe(true);
            expect(isFree(undefined)).toBe(true);
        });

        it('returns false for paid Basic and Pro', () => {
            expect(isFree('basic')).toBe(false);
            expect(isFree('pro')).toBe(false);
        });
    });

    describe('effective tier without legacy trial grants', () => {
        it('does not treat legacy active trial timestamps as Pro before usage refresh completes', () => {
            const profile = {
                subscription_status: 'free',
                trial_expires_at: '2999-01-01T00:00:00.000Z',
            };

            expect(isActiveTrialProfile(profile)).toBe(false);
            expect(getEffectiveSubscriptionStatus(null, profile)).toBe('free');
        });

        it('treats expired legacy trial Free profiles as Free before usage refresh completes', () => {
            const profile = {
                subscription_status: 'free',
                trial_expires_at: '2024-01-01T00:00:00.000Z',
            };

            expect(isActiveTrialProfile(profile)).toBe(false);
            expect(getEffectiveSubscriptionStatus(null, profile)).toBe('free');
        });

        it('lets usage-limit effective status override stale profile state', () => {
            const profile = {
                subscription_status: 'free',
                trial_expires_at: '2999-01-01T00:00:00.000Z',
            };

            expect(getEffectiveSubscriptionStatus('free', profile)).toBe('free');
            expect(getEffectiveSubscriptionStatus('pro', { subscription_status: 'free' })).toBe('pro');
        });
    });

	    describe('hasPaidProEntitlement', () => {
        it('does not treat legacy active trial timestamp as subscribed Pro', () => {
            expect(hasPaidProEntitlement({
                subscription_status: 'free',
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

	    describe('hasCloudSttEntitlement', () => {
	        it('does not allow legacy active trial timestamp profiles to use Cloud STT', () => {
	            expect(hasCloudSttEntitlement({
	                subscription_status: 'free',
	                trial_expires_at: '2999-01-01T00:00:00.000Z',
	            })).toBe(false);
	        });

	        it('allows subscribed Pro profiles to use Cloud STT', () => {
	            expect(hasCloudSttEntitlement({
	                subscription_status: 'pro',
	                stripe_subscription_id: 'sub_123',
	            })).toBe(true);
	        });

	        it('does not allow expired legacy trials or unsubscribed Pro-shaped profiles to use Cloud STT', () => {
	            expect(hasCloudSttEntitlement({
	                subscription_status: 'free',
	                trial_expires_at: '2024-01-01T00:00:00.000Z',
	            })).toBe(false);

	            expect(hasCloudSttEntitlement({
	                subscription_status: 'pro',
	            })).toBe(false);
	        });
	    });

	    describe('getTierLabel', () => {
        it('returns "Pro" for pro users', () => {
            expect(getTierLabel('pro')).toBe('Pro');
        });

        it('retains a label for the future paid Basic tier', () => {
            expect(getTierLabel('basic')).toBe('Basic');
        });

        it('returns "Free" for free/null/undefined', () => {
            expect(getTierLabel('free')).toBe('Free');
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
            expect(getDailyLimit('free')).toBe(3600);
            expect(getDailyLimit('basic')).toBe(3600);
            expect(getDailyLimit('pro')).toBe(Infinity);
        });

        it('getMaxFillerWords returns 100 for all active tiers', () => {
            expect(getMaxFillerWords('free')).toBe(100);
            expect(getMaxFillerWords('basic')).toBe(100);
            expect(getMaxFillerWords('pro')).toBe(100);
        });
    });

    describe('TIER_LIMITS', () => {
        it('FREE tier has correct soft release limits', () => {
            const freeLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.FREE];
            expect(freeLimits.maxCustomWords).toBe(100);
            expect(freeLimits.dailySeconds).toBe(3600);
            expect(freeLimits.maxSessionDuration).toBe(Infinity);
        });

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
