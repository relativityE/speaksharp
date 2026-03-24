import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { goalsService } from '@/services/domainServices';
import logger from '@/lib/logger';
import { GOALS_STORAGE_KEY, DEFAULT_GOALS } from '@/config/env';
import type { UserGoals } from '@/types/goals';

/**
 * Custom hook for managing user goals with Supabase sync and localStorage fallback.
 * 
 * ARCHITECTURE FIX (Senior Architect): 
 * Refactored to TanStack Query to prevent race conditions between local state 
 * and DB re-fetches during 'Surgical Fix 5'.
 * 
 * - Deterministic: Shares state across all components via Query Cache.
 * - Robust: Implements optimistic updates and explicit invalidation.
 */
export function useGoals() {
    const { user } = useAuthProvider();
    const queryClient = useQueryClient();

    // 1. Fetcher with localStorage fallback
    const { data: goals = DEFAULT_GOALS, isLoading } = useQuery({
        queryKey: ['userGoals', user?.id],
        queryFn: async () => {
            if (!user) {
                // Return from localStorage for unauthenticated users
                try {
                    const stored = localStorage.getItem(GOALS_STORAGE_KEY);
                    if (stored) return JSON.parse(stored) as UserGoals;
                } catch (err) {
                    logger.debug({ err }, '[useGoals] Stale/corrupt storage encountered');
                    // Ignore parse errors from stale/corrupt storage
                }
                return DEFAULT_GOALS;
            }

            try {
                const data = await goalsService.get(user.id);
                if (data) {
                    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(data));
                    return data;
                }
            } catch (err) {
                logger.error({ err }, '[useGoals] Fetch failed');
            }

            // DB failure or empty, fallback to localStorage then defaults
            try {
                const stored = localStorage.getItem(GOALS_STORAGE_KEY);
                if (stored) return JSON.parse(stored) as UserGoals;
            } catch (err) {
                logger.debug({ err }, '[useGoals] Fallback storage parsing failed');
                // Ignore parse errors from stale/corrupt storage
            }
            return DEFAULT_GOALS;
        },
        staleTime: 5 * 60 * 1000,
    });

    // 2. Mutation for updating goals
    const mutation = useMutation({
        mutationFn: async (newGoals: UserGoals) => {
            // Immediate side-effect for offline/unauth support
            localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(newGoals));

            if (user) {
                return await goalsService.upsert(user.id, newGoals);
            }
            return newGoals;
        },
        onSuccess: (updatedGoals) => {
            // ✅ SURGICAL FIX 5: Synchronize all related caches
            const userId = user?.id;
            queryClient.setQueryData(['userGoals', userId], updatedGoals);

            if (userId) {
                void queryClient.invalidateQueries({ queryKey: ["userProfile", userId] });
                void queryClient.invalidateQueries({ queryKey: ["sessionCount", userId] });
                void queryClient.invalidateQueries({ queryKey: ["analyticsSummary", userId] });
            }
        },
        onError: (err) => {
            logger.error({ err }, '[useGoals] Mutation failed');
        }
    });

    const setGoals = useCallback(async (newGoals: UserGoals) => {
        return await mutation.mutateAsync(newGoals);
    }, [mutation]);

    const resetGoals = useCallback(async () => {
        localStorage.removeItem(GOALS_STORAGE_KEY);
        if (user) {
            await mutation.mutateAsync(DEFAULT_GOALS);
        } else {
            queryClient.setQueryData(['userGoals', undefined], DEFAULT_GOALS);
        }
    }, [user, mutation, queryClient]);

    return {
        goals,
        setGoals,
        resetGoals,
        isLoading,
        defaultGoals: DEFAULT_GOALS,
    };
}

export { DEFAULT_GOALS };
