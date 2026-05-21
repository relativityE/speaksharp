/**
 * Subscription Tier Constants
 * 
 * Single source of truth for subscription tier logic.
 * Use these constants and helpers instead of string comparisons.
 */

export const SUBSCRIPTION_TIERS = {
    BASIC: 'basic',
    PRO: 'pro',
} as const;

export type SubscriptionTier = typeof SUBSCRIPTION_TIERS[keyof typeof SUBSCRIPTION_TIERS];

export function normalizeSubscriptionTier(subscriptionStatus: string | undefined | null): SubscriptionTier {
    return subscriptionStatus === SUBSCRIPTION_TIERS.PRO
        ? SUBSCRIPTION_TIERS.PRO
        : SUBSCRIPTION_TIERS.BASIC;
}

/**
 * Check if a subscription status indicates Pro tier
 */
export function isPro(_subscriptionStatus: string | undefined | null): boolean {
    return _subscriptionStatus === SUBSCRIPTION_TIERS.PRO;
    // return true; // FORCE PRO FOR TESTING (Unblocking Private STT)
}

type TierProfile = {
    subscription_status?: string | null;
    trial_expires_at?: string | null;
    stripe_subscription_id?: string | null;
    subscription_id?: string | null;
} | null | undefined;

/**
 * Trial users are effectively Pro until the server-issued trial expiry passes.
 */
export function isActiveTrialProfile(profile: TierProfile, nowMs = Date.now()): boolean {
    if (!profile?.trial_expires_at) return false;

    const expiresAtMs = Date.parse(profile.trial_expires_at);
    return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

export function getEffectiveSubscriptionStatus(
    usageLimitStatus?: string | null,
    profile?: TierProfile
): SubscriptionTier {
    if (usageLimitStatus) {
        return normalizeSubscriptionTier(usageLimitStatus);
    }

    if (isActiveTrialProfile(profile)) {
        return SUBSCRIPTION_TIERS.PRO;
    }

    return normalizeSubscriptionTier(profile?.subscription_status);
}

/**
 * Check if a subscription status indicates the baseline tier
 */
export function isBasic(subscriptionStatus: string | undefined | null): boolean {
    return subscriptionStatus === SUBSCRIPTION_TIERS.BASIC;
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
    [SUBSCRIPTION_TIERS.BASIC]: {
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
    const tier = normalizeSubscriptionTier(subscriptionStatus);
    return TIER_LIMITS[tier];
}

/**
 * Get specific limit getters for centralized access
 */
export const getDailyLimit = (subscriptionStatus: string | undefined | null) =>
    getTierLimits(subscriptionStatus).dailySeconds;

export const getMaxFillerWords = (subscriptionStatus: string | undefined | null) =>
    getTierLimits(subscriptionStatus).maxCustomWords;
