/**
 * Subscription Tier Constants
 * 
 * Single source of truth for subscription tier logic.
 * Use these constants and helpers instead of string comparisons.
 */

export const SUBSCRIPTION_TIERS = {
    FREE: 'free',
    BASIC: 'basic',
    PRO: 'pro',
} as const;

export type SubscriptionTier = typeof SUBSCRIPTION_TIERS[keyof typeof SUBSCRIPTION_TIERS];

export function normalizeSubscriptionTier(subscriptionStatus: string | undefined | null): SubscriptionTier {
    return subscriptionStatus === SUBSCRIPTION_TIERS.PRO
        ? SUBSCRIPTION_TIERS.PRO
        : subscriptionStatus === SUBSCRIPTION_TIERS.BASIC
            ? SUBSCRIPTION_TIERS.BASIC
        : SUBSCRIPTION_TIERS.FREE;
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

export function hasPaidProEntitlement(profile: TierProfile): boolean {
    if (normalizeSubscriptionTier(profile?.subscription_status) !== SUBSCRIPTION_TIERS.PRO) {
        return false;
    }

    return Boolean(profile?.stripe_subscription_id?.trim() || profile?.subscription_id?.trim());
}

export function hasCloudSttEntitlement(profile: TierProfile): boolean {
    return hasPaidProEntitlement(profile);
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
 * Check if a subscription status indicates the future paid Basic tier
 */
export function isBasic(subscriptionStatus: string | undefined | null): boolean {
    return subscriptionStatus === SUBSCRIPTION_TIERS.BASIC;
}

export function isFree(subscriptionStatus: string | undefined | null): boolean {
    return normalizeSubscriptionTier(subscriptionStatus) === SUBSCRIPTION_TIERS.FREE;
}

/**
 * Get tier label for display
 */
export function getTierLabel(subscriptionStatus: string | undefined | null): string {
    if (isPro(subscriptionStatus)) return 'Pro';
    if (isBasic(subscriptionStatus)) return 'Basic';
    return 'Free';
}

/**
 * Tier-based limits
 */
export const TIER_LIMITS = {
    [SUBSCRIPTION_TIERS.FREE]: {
        dailySeconds: 3600,
        maxCustomWords: 100,
        maxSessionDuration: Infinity,
    },
    [SUBSCRIPTION_TIERS.BASIC]: {
        dailySeconds: 3600, // 1 hour per day
        maxCustomWords: 100, // Matched with Pro
        maxSessionDuration: Infinity, // No session-level cap, only daily
    },
    [SUBSCRIPTION_TIERS.PRO]: {
        // 2h/day — MUST match the effective enforcement source: DB tier_configs 'pro'
        // (daily_limit_seconds = 7200, monthly 180000). Pro is NOT unlimited for this release;
        // raising it is a deliberate Product/pricing decision, not a stale-config drift.
        dailySeconds: 7200,
        maxCustomWords: 100,
        maxSessionDuration: Infinity, // No session-level cap, only daily
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
