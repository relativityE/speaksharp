import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.44.4';
import { ErrorCodes, createErrorResponse, createSuccessResponse } from '../_shared/errors.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FREE_TIER_LIMIT_SECONDS = 1800; // 30 minutes

interface UsageLimitResponse {
    can_start: boolean;
    remaining_seconds: number; // -1 for unlimited (Pro)
    limit_seconds: number;
    used_seconds: number;
    subscription_status: string;
    is_pro: boolean;
    error?: string;
}

type SupabaseClientFactory = (authHeader: string | null) => SupabaseClient;

// Define the handler with dependency injection for testability
export async function handler(req: Request, createSupabase: SupabaseClientFactory) {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        const supabaseClient = createSupabase(authHeader);

        const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

        if (userError || !user) {
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
            .eq('id', user.id)
            .single();

        if (profileError) {
            console.error('Profile fetch error:', profileError);
            // Default to allowing start if profile not found
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

        // Reset usage if a new month has started
        const resetDate = profile.usage_reset_date ? new Date(profile.usage_reset_date) : null;

        // Robust "one month ago" logic that handles varying month lengths correctly in JS
        const oneMonthAgo = new Date();
        const currentMonth = oneMonthAgo.getMonth();
        oneMonthAgo.setMonth(currentMonth - 1);

        // If JS rolls forward (e.g. March 31 -> March 3), cap it at the last day of the target month
        if (oneMonthAgo.getMonth() === currentMonth) {
            oneMonthAgo.setDate(0);
        }

        if (!resetDate || resetDate <= oneMonthAgo) {
            usedSeconds = 0;
            // P0 FIX: Actually persist the reset to the database
            const newResetDate = new Date().toISOString();
            const { error: resetError } = await supabaseClient
                .from('user_profiles')
                .update({
                    usage_seconds: 0,
                    usage_reset_date: newResetDate,
                })
                .eq('id', user.id);

            if (resetError) {
                console.error('Failed to reset usage in database:', resetError);
                // Continue with local reset value - user experience is still correct
            } else {
                console.log(`✅ Monthly usage reset for user ${user.id}, new reset date: ${newResetDate}`);
            }
        }

        // Pro users have unlimited usage (unless promo expired)
        if (isPro) {
            // Check for promo expiration
            if (profile.promo_expires_at) {
                const expiry = new Date(profile.promo_expires_at);
                if (expiry < new Date()) {
                    console.log(`[check-usage-limit] Promo expired for user ${user.id} at ${expiry.toISOString()}`);

                    // Downgrade user back to free (and potentially let them fall through to free tier logic)
                    // Note: In a real app we might want to do this async/lazily, but here we enforce "no start" or "revert"
                    // Ideally we update the DB to reflect 'free' again so the UI updates
                    await supabaseClient.from('user_profiles').update({ subscription_status: 'free' }).eq('id', user.id);

                    // Return response as if they are free (limit reached or not)
                    // Recursive call or just fall through? 
                    // Simpler: just fall through to free logic below by treating isPro as false
                    // We need to re-fetch/re-eval? No, just fall through.
                } else {
                    // Promo active
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
                // Permanent Pro
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

        // Calculate remaining for free users
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

        console.log(`✅ Usage check for user ${user.id}: ${remainingSeconds}s remaining, can_start: ${canStart}`);

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
