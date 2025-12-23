import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';

/**
 * Response from check-usage-limit Edge Function
 */
export interface UsageLimitCheck {
    can_start: boolean;
    remaining_seconds: number; // -1 for unlimited (Pro)
    limit_seconds: number;
    used_seconds?: number;
    subscription_status: string;
    is_pro: boolean;
    error?: string;
}

/**
 * Hook to check user's usage limit before starting a session.
 * This enables pre-session validation to prevent frustrating UX
 * where users record for minutes only to find they can't save.
 * 
 * Calls the check-usage-limit Edge Function.
 * 
 * @returns Query result with usage limit information
 */
export function useUsageLimit() {
    const { user, session } = useAuthProvider();

    return useQuery({
        queryKey: ['usageLimit', user?.id],
        queryFn: async (): Promise<UsageLimitCheck> => {
            const supabase = getSupabaseClient();
            if (!supabase) {
                console.error('[useUsageLimit] Supabase client not available');
                return {
                    can_start: false,
                    remaining_seconds: 0,
                    limit_seconds: 1800,
                    subscription_status: 'unknown',
                    is_pro: false,
                    error: 'Supabase client not available'
                };
            }

            // Call the Edge Function
            const { data, error } = await supabase.functions.invoke('check-usage-limit', {
                headers: {
                    Authorization: `Bearer ${session?.access_token}`
                }
            });

            if (error) {
                console.error('[useUsageLimit] Error checking usage limit:', error);
                // Default to allowing start on error to not block users
                return {
                    can_start: true,
                    remaining_seconds: 1800,
                    limit_seconds: 1800,
                    subscription_status: 'unknown',
                    is_pro: false,
                    error: error.message
                };
            }

            console.log('[useUsageLimit] Usage limit check result:', data);
            return data as UsageLimitCheck;
        },
        enabled: !!user && !!session, // Only run when user is authenticated with session
        staleTime: 30 * 1000, // Revalidate every 30 seconds
        refetchOnWindowFocus: true,
    });
}

/**
 * Format remaining seconds as human-readable string
 */
export function formatRemainingTime(seconds: number): string {
    if (seconds < 0) return 'Unlimited';
    if (seconds === 0) return 'No time remaining';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes === 0) {
        return `${remainingSeconds}s`;
    }
    if (remainingSeconds === 0) {
        return `${minutes}m`;
    }
    return `${minutes}m ${remainingSeconds}s`;
}
