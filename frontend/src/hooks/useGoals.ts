import { useCallback, useState } from 'react';
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
    const userId = user?.id;
    // The old shared key has no reliable owner. Never import it into any account.
    const storageKey = userId ? `${GOALS_STORAGE_KEY}:user:${userId}` : `${GOALS_STORAGE_KEY}:anonymous`;
    const [syncFailures, setSyncFailures] = useState<Map<string | undefined, unknown>>(() => new Map());

    // 1. Fetcher with localStorage fallback
    const { data, isLoading, error: loadError } = useQuery({
        queryKey: ['userGoals', userId],
        queryFn: async ({ signal }) => {
            if (!userId) {
                return safeLocalStorageGetJSON(storageKey, DEFAULT_GOALS);
            }

            const remote = await goalsService.get(userId);
            if (remote) {
                if (!signal.aborted) safeLocalStorageSet(storageKey, JSON.stringify(remote));
                return remote;
            }

            return safeLocalStorageGetJSON(storageKey, DEFAULT_GOALS);
        },
        staleTime: 5 * 60 * 1000,
        retry: false,
        placeholderData: undefined,
    });
    const goals = data ?? safeLocalStorageGetJSON(storageKey, DEFAULT_GOALS);

    // 2. Mutation for updating goals
    const mutation = useMutation({
        mutationFn: async ({ newGoals, ownerId, key }: { newGoals: UserGoals; ownerId: string | undefined; key: string }) => {
            safeLocalStorageSet(key, JSON.stringify(newGoals));

            if (ownerId) {
                try {
                    return { goals: await goalsService.upsert(ownerId, newGoals), error: null };
                } catch (err) {
                    logger.info({ err }, '[useGoals] Remote goal sync failed; keeping local goals');
                    return { goals: newGoals, error: err };
                }
            }
            return { goals: newGoals, error: null };
        },
        onSuccess: (settled, variables) => {
            const ownerId = variables.ownerId;
            queryClient.setQueryData(['userGoals', ownerId], settled.goals);
            setSyncFailures(previous => new Map(previous).set(ownerId, settled.error));

            if (ownerId) {
                void queryClient.invalidateQueries({ queryKey: ["userProfile", ownerId] });
                void queryClient.invalidateQueries({ queryKey: ["sessionCount", ownerId] });
                void queryClient.invalidateQueries({ queryKey: ["analyticsSummary", ownerId] });
            }
        },
        onError: (err) => {
            logger.error({ err }, '[useGoals] Mutation failed');
        }
    });

    const setGoals = useCallback(async (newGoals: UserGoals) => {
        await queryClient.cancelQueries({ queryKey: ['userGoals', userId], exact: true });
        const settled = await mutation.mutateAsync({ newGoals, ownerId: userId, key: storageKey });
        return settled.goals;
    }, [mutation, userId, storageKey, queryClient]);

    const resetGoals = useCallback(async () => {
        await queryClient.cancelQueries({ queryKey: ['userGoals', userId], exact: true });
        safeLocalStorageRemove(storageKey);
        if (userId) {
            await mutation.mutateAsync({ newGoals: DEFAULT_GOALS, ownerId: userId, key: storageKey });
        } else {
            queryClient.setQueryData(['userGoals', undefined], DEFAULT_GOALS);
        }
    }, [userId, storageKey, mutation, queryClient]);

    return {
        goals,
        setGoals,
        resetGoals,
        isLoading,
        syncError: loadError ?? syncFailures.get(userId) ?? null,
        defaultGoals: DEFAULT_GOALS,
    };
}

export { DEFAULT_GOALS };
