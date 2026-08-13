import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';

/**
 * Response from check-usage-limit Edge Function
 */
export interface UsageLimitCheck {
    can_start: boolean;
    subscription_status: string;
    is_pro: boolean;
    streak_count: number;
    trial_active?: boolean;
    trial_started_at?: string | null;
    trial_expires_at?: string | null;
    trial_seconds_remaining?: number;
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
/**
 * Default fetcher for usage limit check (Phase 3 - Step 1 Alignment)
 */
const defaultFetchUsageLimit = async (session?: { access_token: string }): Promise<UsageLimitCheck> => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase client not available');

    const { data, error } = await supabase.functions.invoke('check-usage-limit', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
    });

    if (error) throw new Error(error.message);
    return data as UsageLimitCheck;
};

/**
 * Hook to check user's usage limit.
 * Follows exact Phase 3 - Step 1 prescription.
 */
export function useUsageLimit(deps?: { fetchUsageLimit?: () => Promise<UsageLimitCheck> }) {
    const { user, session } = useAuthProvider();

    // Prescribed Path: const fetcher = deps?.fetchUsageLimit ?? defaultFetchUsageLimit
    // Note: We wrap in useQuery for UI-side state management (loading/error).
    return useQuery({
        queryKey: ['usageLimit', user?.id],
        queryFn: async (): Promise<UsageLimitCheck> => {
            const e2eDeps = (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>).__E2E_DEPS__ : null) as { fetchUsageLimit?: () => Promise<UsageLimitCheck> } | null;
            const fetcher = deps?.fetchUsageLimit || e2eDeps?.fetchUsageLimit || (() => defaultFetchUsageLimit(session as { access_token: string }));
            return fetcher();
        },
        enabled: !!user && !!session,
        staleTime: 0,
        refetchOnWindowFocus: true,
    });
}
