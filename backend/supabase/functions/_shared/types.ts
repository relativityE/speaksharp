/**
 * Shared types between Frontend and Supabase Edge Functions.
 * Import in Frontend via: import { ... } from '@shared/types'
 * Import in Backend via: import { ... } from '../_shared/types.ts'
 */

// Usage Limit API
export interface UsageLimitResponse {
    can_start: boolean;
    is_pro: boolean;
    remaining_seconds: number;
    limit_seconds: number;
    used_seconds: number;
    error?: string;
}

// Stripe Checkout API
export interface StripeCheckoutResponse {
    checkoutUrl: string;
}

// User Profile
export interface UserProfile {
    id: string;
    subscription_status: 'free' | 'pro';
    usage_seconds: number;
    usage_reset_date: string;
}
