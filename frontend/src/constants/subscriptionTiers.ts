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
export function isPro(subscriptionStatus: string | undefined | null): boolean {
    return subscriptionStatus === SUBSCRIPTION_TIERS.PRO;
}

/**
 * Check if a subscription status indicates Free tier
 */
export function isFree(subscriptionStatus: string | undefined | null): boolean {
    return subscriptionStatus === SUBSCRIPTION_TIERS.FREE;
}

/**
 * Get tier label for display
 */
export function getTierLabel(subscriptionStatus: string | undefined | null): string {
    return isPro(subscriptionStatus) ? 'Pro' : 'Free';
}

/**
 * Tier-based limits
 */
export const TIER_LIMITS = {
    [SUBSCRIPTION_TIERS.FREE]: {
        maxCustomWords: 10,
        monthlyMinutes: 30,
        maxSessionDuration: 20, // minutes
    },
    [SUBSCRIPTION_TIERS.PRO]: {
        maxCustomWords: 100,
        monthlyMinutes: Infinity,
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
