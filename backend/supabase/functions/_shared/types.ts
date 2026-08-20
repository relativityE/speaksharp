/**
 * Shared types between Frontend and Supabase Edge Functions.
 * Import in Frontend via: import { ... } from '@shared/types'
 * Import in Backend via: import { ... } from '../_shared/types.ts'
 */

// Recording-access API (legacy endpoint name: check-usage-limit)
export interface UsageLimitResponse {
    can_start: boolean;
    is_pro: boolean;
    subscription_status: string;
    trial_active?: boolean;
    trial_expires_at?: string | null;
    trial_seconds_remaining?: number;
    error?: string;
}

// Stripe Checkout API
export interface StripeCheckoutResponse {
    checkoutUrl: string;
}

// User Profile
export interface UserProfile {
    id: string;
    subscription_status: 'free' | 'basic' | 'pro';
    usage_seconds: number;
    usage_reset_date: string;
}
