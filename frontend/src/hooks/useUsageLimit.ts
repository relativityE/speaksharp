import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';
import logger from '@/lib/logger';

/**
 * Response from check-usage-limit Edge Function
 */
export interface UsageLimitCheck {
    can_start: boolean;
    daily_remaining: number; // For the new "Sunsetting" UX
    daily_limit: number;
    monthly_remaining: number; // For COGS protection check
    monthly_limit: number;
    remaining_seconds: number; // Legacy, kept for compatibility with existing UI
    subscription_status: string;
    is_pro: boolean;
    streak_count: number;
    promo_just_expired?: boolean;
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
                logger.error('[useUsageLimit] Supabase client not available');
                return {
                    can_start: false,
                    daily_remaining: 0,
                    daily_limit: 3600,
                    monthly_remaining: 0,
                    monthly_limit: 90000,
                    remaining_seconds: 0,
                    subscription_status: 'unknown',
                    is_pro: false,
                    streak_count: 0,
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
                logger.error({ err: error }, '[useUsageLimit] Error checking usage limit');
                // Default to allowing start on error to not block users
                return {
                    can_start: true,
                    daily_remaining: 3600,
                    daily_limit: 3600,
                    monthly_remaining: 90000,
                    monthly_limit: 90000,
                    remaining_seconds: 3600,
                    subscription_status: 'unknown',
                    is_pro: false,
                    streak_count: 0,
                    error: error.message
                };
            }

            return data as UsageLimitCheck;
        },
        enabled: !!user && !!session, // Only run when user is authenticated with session
        staleTime: 0, // Always revalidate to ensure accurate enforcement (usage can change in other tabs)
        refetchOnWindowFocus: true, // Re-check when user returns to tab
    });
}

/**
 * Optimistic usage update to prevent Tier + DB race conditions (E15, E17).
 * Updates the react-query cache immediately before DB sync.
 */
export function updateLocalUsage(userId: string, additionalSeconds: number) {
    // Use direct dynamic import for better compatibility with test environment
    const win = window as unknown as { 
        queryClientAPI?: { getQueryClient: () => unknown };
        queryClient?: unknown;
    };
    const { getQueryClient } = win.queryClientAPI || { getQueryClient: () => win.queryClient };
    const queryClient = (getQueryClient?.() || win.queryClient) as { 
        setQueryData: (key: unknown[], updater: (old: UsageLimitCheck | undefined) => UsageLimitCheck | undefined) => void 
    };
    
    if (!queryClient) {
        logger.warn('[updateLocalUsage] QueryClient not found, skipping optimistic update');
        return;
    }

    queryClient.setQueryData(['usageLimit', userId], (old: UsageLimitCheck | undefined) => {
        if (!old) return old;
        return {
            ...old,
            daily_remaining: Math.max(0, old.daily_remaining - additionalSeconds),
            remaining_seconds: Math.max(0, old.remaining_seconds - additionalSeconds),
        };
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
