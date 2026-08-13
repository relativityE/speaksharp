import { describe, it, expect } from 'vitest';
import {
    SUBSCRIPTION_TIERS,
    TIER_LIMITS,
    isPro,
    isFree,
	    getEffectiveSubscriptionStatus,
	    hasPaidProEntitlement,
    isActiveTrialProfile,
    getTierLabel,
    getTierLimits,
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

    describe('isFree', () => {
        it('returns true for "free" and unknown empty statuses', () => {
            expect(isFree('free')).toBe(true);
            expect(isFree(null)).toBe(true);
            expect(isFree(undefined)).toBe(true);
        });

        it('treats retired or unknown tiers as Free and Pro as paid', () => {
            expect(isFree('basic')).toBe(true);
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

        it('treats a stale subscription_status=pro with no Stripe id as Free in the profile fallback', () => {
            // Guards the 1012 stale status='pro' rows: without a stripe_subscription_id they must not
            // read Pro from the bare status string during the usage-limit load window.
            expect(getEffectiveSubscriptionStatus(null, { subscription_status: 'pro' })).toBe('free');
            expect(getEffectiveSubscriptionStatus(null, { subscription_status: 'pro', subscription_id: 'legacy_123' })).toBe('free');
        });

        it('honors a real paid Pro (status pro + stripe_subscription_id) in the profile fallback', () => {
            expect(getEffectiveSubscriptionStatus(null, { subscription_status: 'pro', stripe_subscription_id: 'sub_live_1' })).toBe('pro');
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

        it('does not treat the legacy subscription_id column as a paid signal', () => {
            expect(hasPaidProEntitlement({
                subscription_status: 'pro',
                subscription_id: 'sub_legacy_123',
            })).toBe(false);
        });
	    });

	    describe('getTierLabel', () => {
        it('returns "Pro" for pro users', () => {
            expect(getTierLabel('pro')).toBe('Pro');
        });

        it('does not expose a retired Basic product label', () => {
            expect(getTierLabel('basic')).toBe('Free');
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

        it('maps retired Basic state to the shared Free-compatible constants', () => {
            const limits = getTierLimits('basic');
            expect(limits).toBe(TIER_LIMITS[SUBSCRIPTION_TIERS.FREE]);
        });

        it('returns PRO limits for "pro"', () => {
            const limits = getTierLimits('pro');
            expect(limits).toBe(TIER_LIMITS[SUBSCRIPTION_TIERS.PRO]);
        });

        it('does not encode accumulated recording quotas', () => {
            for (const limits of Object.values(TIER_LIMITS)) {
                expect(limits).toEqual({ maxCustomWords: 100 });
            }
        });
    });

    describe('getters', () => {
        it('getMaxFillerWords returns 100 for all active tiers', () => {
            expect(getMaxFillerWords('free')).toBe(100);
            expect(getMaxFillerWords('basic')).toBe(100);
            expect(getMaxFillerWords('pro')).toBe(100);
        });
    });

    describe('TIER_LIMITS', () => {
        it('legacy FREE status has the shared content-feature constant', () => {
            const freeLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.FREE];
            expect(freeLimits.maxCustomWords).toBe(100);
        });

        it('paid status has the same content-feature constant', () => {
            const proLimits = TIER_LIMITS[SUBSCRIPTION_TIERS.PRO];
            expect(proLimits.maxCustomWords).toBe(100);
        });
    });
});
