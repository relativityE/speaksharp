import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuthProvider } from '@/contexts/AuthProvider';
import logger from '../lib/logger';
import {
    PRIVATE_SAMPLE_EVENTS,
    emitPrivateSample,
    getPrivateSampleContext,
} from '@/services/transcription/privateSampleTelemetry';

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
    trial_active?: boolean;
    trial_started_at?: string | null;
    trial_expires_at?: string | null;
    trial_seconds_remaining?: number;
    private_sample_available?: boolean;
    private_sample_limit_seconds?: number;
    private_sample_seconds_used?: number;
    private_sample_seconds_remaining?: number;
    private_sample_started_at?: string | null;
    private_sample_completed_at?: string | null;
    private_sample_session_id?: string | null;
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

    let sampleUpdate: { used: number; remaining: number; wasAbove: boolean } | null = null;
    queryClient.setQueryData(['usageLimit', userId], (old: UsageLimitCheck | undefined) => {
        if (!old) return old;
        const hasSample = typeof old.private_sample_seconds_used === 'number'
            && typeof old.private_sample_seconds_remaining === 'number';
        const nextRemaining = hasSample
            ? Math.max(0, (old.private_sample_seconds_remaining as number) - additionalSeconds)
            : old.private_sample_seconds_remaining;
        const nextUsed = hasSample
            ? (old.private_sample_seconds_used as number) + additionalSeconds
            : old.private_sample_seconds_used;
        if (hasSample) {
            sampleUpdate = {
                used: nextUsed as number,
                remaining: nextRemaining as number,
                wasAbove: (old.private_sample_seconds_remaining as number) > 0,
            };
        }
        return {
            ...old,
            daily_remaining: Math.max(0, old.daily_remaining - additionalSeconds),
            remaining_seconds: Math.max(0, old.remaining_seconds - additionalSeconds),
            private_sample_seconds_remaining: nextRemaining,
            private_sample_seconds_used: nextUsed,
        };
    });

    // Emit sample usage telemetry whenever a Private sample is the active arm (so native/cloud
    // usage updates don't fire). Driven by the active sample CONTEXT, not the cached usage shape:
    // a fresh free account's cache may not carry private_sample_seconds_* yet, so we fall back to
    // the context's sample_limit_seconds + this session's seconds. Never blocks the update above.
    const ctx = getPrivateSampleContext();
    const update = sampleUpdate as { used: number; remaining: number; wasAbove: boolean } | null;
    if (additionalSeconds > 0 && ctx.engine_variant) {
        const limit = ctx.sample_limit_seconds ?? null;
        const used = update ? update.used : Math.round(additionalSeconds);
        const remaining = update
            ? update.remaining
            : (limit != null ? Math.max(0, limit - used) : null);
        emitPrivateSample(PRIVATE_SAMPLE_EVENTS.USAGE_UPDATED, {
            sample_seconds_used: used,
            sample_seconds_remaining: remaining,
        });
        if (remaining != null && remaining <= 0) {
            emitPrivateSample(PRIVATE_SAMPLE_EVENTS.EXHAUSTED, { sample_seconds_used: used });
        }
    }
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
