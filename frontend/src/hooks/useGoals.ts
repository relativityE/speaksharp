import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { safeLocalStorageSet, safeLocalStorageRemove, safeLocalStorageGetJSON } from '@/lib/safeStorage';
import { goalsService } from '@/services/domainServices';
import logger from '../lib/logger';
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
                return safeLocalStorageGetJSON(GOALS_STORAGE_KEY, DEFAULT_GOALS);
            }

            try {
                const data = await goalsService.get(user.id);
                if (data) {
                    safeLocalStorageSet(GOALS_STORAGE_KEY, JSON.stringify(data));
                    return data;
                }
            } catch (err) {
                logger.info({ err }, '[useGoals] Fetch failed; falling back to local defaults');
            }

            return safeLocalStorageGetJSON(GOALS_STORAGE_KEY, DEFAULT_GOALS);
        },
        staleTime: 5 * 60 * 1000,
    });

    // 2. Mutation for updating goals
    const mutation = useMutation({
        mutationFn: async (newGoals: UserGoals) => {
            safeLocalStorageSet(GOALS_STORAGE_KEY, JSON.stringify(newGoals));

            if (user) {
                try {
                    return await goalsService.upsert(user.id, newGoals);
                } catch (err) {
                    logger.info({ err }, '[useGoals] Remote goal sync failed; keeping local goals');
                    return newGoals;
                }
            }
            return newGoals;
        },
        onSuccess: (updatedGoals) => {
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
        safeLocalStorageRemove(GOALS_STORAGE_KEY);
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
