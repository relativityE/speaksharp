/**
 * Subscription Tier Constants
 * 
 * Single source of truth for subscription tier logic.
 * Use these constants and helpers instead of string comparisons.
 */

export const SUBSCRIPTION_TIERS = {
    FREE: 'free',
    PRO: 'pro',
} as const;

export type SubscriptionTier = typeof SUBSCRIPTION_TIERS[keyof typeof SUBSCRIPTION_TIERS];

/**
 * Check if a subscription status indicates Pro tier
 */
export function isPro(_subscriptionStatus: string | undefined | null): boolean {
    return _subscriptionStatus === SUBSCRIPTION_TIERS.PRO;
    // return true; // FORCE PRO FOR TESTING (Unblocking Private STT)
}

type TierProfile = {
    subscription_status?: string | null;
    promo_expires_at?: string | null;
    stripe_subscription_id?: string | null;
    subscription_id?: string | null;
} | null | undefined;

/**
 * Promo-only Pro users must fall back to the baseline tier immediately after
 * expiry, even before the usage-limit query has refreshed the effective tier.
 */
export function isExpiredPromoOnlyProfile(profile: TierProfile, nowMs = Date.now()): boolean {
    if (!isPro(profile?.subscription_status) || !profile?.promo_expires_at) return false;
    if (profile.stripe_subscription_id || profile.subscription_id) return false;

    const expiresAtMs = Date.parse(profile.promo_expires_at);
    return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

export function getEffectiveSubscriptionStatus(
    usageLimitStatus?: string | null,
    profile?: TierProfile
): SubscriptionTier {
    if (usageLimitStatus) {
        return isPro(usageLimitStatus) ? SUBSCRIPTION_TIERS.PRO : SUBSCRIPTION_TIERS.FREE;
    }

    if (isExpiredPromoOnlyProfile(profile)) {
        return SUBSCRIPTION_TIERS.FREE;
    }

    return isPro(profile?.subscription_status) ? SUBSCRIPTION_TIERS.PRO : SUBSCRIPTION_TIERS.FREE;
}

/**
 * Check if a subscription status indicates the baseline tier
 */
export function isFree(subscriptionStatus: string | undefined | null): boolean {
    return subscriptionStatus === SUBSCRIPTION_TIERS.FREE;
}

/**
 * Get tier label for display
 */
export function getTierLabel(subscriptionStatus: string | undefined | null): string {
    return isPro(subscriptionStatus) ? 'Pro' : 'Basic';
}

/**
 * Tier-based limits
 */
export const TIER_LIMITS = {
    [SUBSCRIPTION_TIERS.FREE]: {
        dailySeconds: 3600, // 1 hour per day
        maxCustomWords: 100, // Matched with Pro
        maxSessionDuration: Infinity, // No session-level cap, only daily
    },
    [SUBSCRIPTION_TIERS.PRO]: {
        dailySeconds: Infinity,
        maxCustomWords: 100,
        maxSessionDuration: Infinity,
    },
} as const;

/**
 * Get limits for a subscription tier
 */
export function getTierLimits(subscriptionStatus: string | undefined | null) {
    const tier = isPro(subscriptionStatus) ? SUBSCRIPTION_TIERS.PRO : SUBSCRIPTION_TIERS.FREE;
    return TIER_LIMITS[tier];
}

/**
 * Get specific limit getters for centralized access
 */
export const getDailyLimit = (subscriptionStatus: string | undefined | null) =>
    getTierLimits(subscriptionStatus).dailySeconds;

export const getMaxFillerWords = (subscriptionStatus: string | undefined | null) =>
    getTierLimits(subscriptionStatus).maxCustomWords;
