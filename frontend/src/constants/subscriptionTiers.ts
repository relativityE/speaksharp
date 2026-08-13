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
    /** @deprecated legacy column — no longer a paid-entitlement signal; use stripe_subscription_id. */
    subscription_id?: string | null;
} | null | undefined;

/** Legacy trial timestamps are not a client-side entitlement source. */
export function isActiveTrialProfile(_profile: TierProfile, _nowMs = Date.now()): boolean {
    return false;
}

export function hasPaidProEntitlement(profile: TierProfile): boolean {
    if (normalizeSubscriptionTier(profile?.subscription_status) !== SUBSCRIPTION_TIERS.PRO) {
        return false;
    }

    // Production Pro requires the canonical stripe_subscription_id. The legacy subscription_id
    // column is deprecated and intentionally NOT read here (see migration deprecating it).
    return Boolean(profile?.stripe_subscription_id?.trim());
}

export function getEffectiveSubscriptionStatus(
    usageLimitStatus?: string | null,
    profile?: TierProfile
): SubscriptionTier {
    if (usageLimitStatus) {
        // The usage-limit status is already the server effective tier (check_usage_limit →
        // effective_subscription_tier), so it is authoritative when present.
        return normalizeSubscriptionTier(usageLimitStatus);
    }

    // Profile fallback (usage limit not loaded yet): a profile is Pro ONLY with real Stripe
    // evidence. A stale subscription_status='pro' with no stripe_subscription_id must read Free —
    // matching the server effective tier — otherwise it briefly flashes Pro UI/policy during the
    // usage-limit load window. Mirrors hasPaidProEntitlement so the frontend never trusts the bare
    // status string for Pro.
    const profileTier = normalizeSubscriptionTier(profile?.subscription_status);
    if (profileTier === SUBSCRIPTION_TIERS.PRO && !hasPaidProEntitlement(profile)) {
        return SUBSCRIPTION_TIERS.FREE;
    }
    return profileTier;
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

/** Content-feature constants retained for legacy status compatibility. */
export const TIER_LIMITS = {
    [SUBSCRIPTION_TIERS.FREE]: {
        maxCustomWords: 100,
    },
    [SUBSCRIPTION_TIERS.BASIC]: {
        maxCustomWords: 100,
    },
    [SUBSCRIPTION_TIERS.PRO]: {
        maxCustomWords: 100,
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
export const getMaxFillerWords = (subscriptionStatus: string | undefined | null) =>
    getTierLimits(subscriptionStatus).maxCustomWords;
