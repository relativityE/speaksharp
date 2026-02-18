import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';
import { ErrorCodes, createErrorResponse, createSuccessResponse } from '../_shared/errors.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FREE_TIER_LIMIT_SECONDS = 3600; // 1 hour per day (Alpha Launch Refactor)

interface UsageLimitResponse {
    can_start: boolean;
    remaining_seconds: number; // -1 for unlimited (Pro)
    limit_seconds: number;
    used_seconds: number;
    subscription_status: string;
    is_pro: boolean;
    promo_just_expired?: boolean; // True if promo expired during this check
    error?: string;
}

type SupabaseClientFactory = (authHeader: string | null) => SupabaseClient;

/**
 * Local JWT parsing to extract user ID without a network call.
 * This saves ~50-100ms by avoiding a redundant round-trip to Supabase Auth.
 */
function getUserIdFromAuthHeader(authHeader: string | null): string | null {
    if (!authHeader) return null;

    // Case-insensitive Bearer prefix check
    if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
    const token = authHeader.substring(7);

    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        // JWT payloads are Base64Url encoded
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');

        // Add padding if missing (required by some atob implementations)
        while (base64.length % 4) {
            base64 += '=';
        }

        const decodedPayload = atob(base64);

        // Use TextDecoder to correctly handle UTF-8 characters
        const bytes = Uint8Array.from(decodedPayload, (c) => c.charCodeAt(0));
        const payload = JSON.parse(new TextDecoder().decode(bytes));

        return payload.sub || null;
    } catch (e) {
        console.error('JWT parse error:', e);
        return null;
    }
}

// Define the handler with dependency injection for testability
export async function handler(req: Request, createSupabase: SupabaseClientFactory) {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        const supabaseClient = createSupabase(authHeader);

        // OPTIMIZATION: Local JWT parsing instead of supabaseClient.auth.getUser()
        const userId = getUserIdFromAuthHeader(authHeader);

        if (!userId) {
            return createErrorResponse(
                ErrorCodes.AUTH_INVALID_TOKEN,
                'Authentication failed',
                corsHeaders
            );
        }

        // Get user profile with usage data
        const { data: profile, error: profileError } = await supabaseClient
            .from('user_profiles')
            .select('usage_seconds, usage_reset_date, subscription_status, promo_expires_at')
            .eq('id', userId)
            .single();

        if (profileError) {
            console.error('Profile fetch error:', profileError);
            const response: UsageLimitResponse = {
                can_start: true,
                remaining_seconds: FREE_TIER_LIMIT_SECONDS,
                limit_seconds: FREE_TIER_LIMIT_SECONDS,
                used_seconds: 0,
                subscription_status: 'unknown',
                is_pro: false,
                error: 'Profile not found - allowing session',
            };
            return createSuccessResponse(response, corsHeaders);
        }

        const isPro = profile.subscription_status === 'pro';
        let usedSeconds = profile.usage_seconds || 0;

        // DAILY RESET LOGIC: Reset usage if more than 24 hours have passed since last reset
        const resetDate = profile.usage_reset_date ? new Date(profile.usage_reset_date) : null;
        const now = new Date();
        const DayInMs = 24 * 60 * 60 * 1000;

        if (!resetDate || (now.getTime() - resetDate.getTime()) >= DayInMs) {
            usedSeconds = 0;
            const newResetDate = now.toISOString();
            const { error: resetError } = await supabaseClient
                .from('user_profiles')
                .update({
                    usage_seconds: 0,
                    usage_reset_date: newResetDate,
                })
                .eq('id', userId);

            if (resetError) {
                console.error('Failed to reset daily usage:', resetError);
            } else {
                console.log(`✅ Daily usage reset for user ${userId}, new reset date: ${newResetDate}`);
            }
        }

        // Pro users have unlimited usage
        if (isPro) {
            if (profile.promo_expires_at) {
                const expiry = new Date(profile.promo_expires_at);
                if (expiry < now) {
                    console.log(`[check-usage-limit] Promo expired for user ${userId}`);
                    await supabaseClient.from('user_profiles').update({ subscription_status: 'free' }).eq('id', userId);

                    const response: UsageLimitResponse = {
                        can_start: true,
                        remaining_seconds: Math.max(0, FREE_TIER_LIMIT_SECONDS - usedSeconds),
                        limit_seconds: FREE_TIER_LIMIT_SECONDS,
                        used_seconds: usedSeconds,
                        subscription_status: 'free',
                        is_pro: false,
                        promo_just_expired: true,
                    };
                    return createSuccessResponse(response, corsHeaders);
                } else {
                    const response: UsageLimitResponse = {
                        can_start: true,
                        remaining_seconds: -1,
                        limit_seconds: -1,
                        used_seconds: usedSeconds,
                        subscription_status: 'pro',
                        is_pro: true,
                    };
                    return createSuccessResponse(response, corsHeaders);
                }
            } else {
                const response: UsageLimitResponse = {
                    can_start: true,
                    remaining_seconds: -1,
                    limit_seconds: -1,
                    used_seconds: usedSeconds,
                    subscription_status: profile.subscription_status,
                    is_pro: true,
                };
                return createSuccessResponse(response, corsHeaders);
            }
        }

        // Calculate daily remaining for free users
        const remainingSeconds = Math.max(0, FREE_TIER_LIMIT_SECONDS - usedSeconds);
        const canStart = remainingSeconds > 0;

        const response: UsageLimitResponse = {
            can_start: canStart,
            remaining_seconds: remainingSeconds,
            limit_seconds: FREE_TIER_LIMIT_SECONDS,
            used_seconds: usedSeconds,
            subscription_status: profile.subscription_status,
            is_pro: false,
        };

        console.log(`✅ Daily usage check (1hr limit) for user ${userId}: ${remainingSeconds}s remaining`);
        return createSuccessResponse(response, corsHeaders);

    } catch (error) {
        console.error('Error checking usage limit:', error);
        const errorMessage = (error instanceof Error) ? error.message : 'An unexpected error occurred';
        return createErrorResponse(
            ErrorCodes.INTERNAL_ERROR,
            errorMessage,
            corsHeaders,
            { can_start: true } // Fail open - allow session
        );
    }
}

// Start the server with the real dependencies
serve((req: Request) => {
    const supabaseClientFactory: SupabaseClientFactory = (authHeader) =>
        createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader! } } }
        );

    return handler(req, supabaseClientFactory);
});
