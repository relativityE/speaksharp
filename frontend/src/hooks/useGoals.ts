import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { safeLocalStorageSet, safeLocalStorageRemove, safeLocalStorageGetJSON } from '@/lib/safeStorage';
import { goalsService } from '@/services/domainServices';
import logger from '../lib/logger';
import { GOALS_STORAGE_KEY, DEFAULT_GOALS } from '@/config/env';
import type { UserGoals } from '@/types/goals';

export type GoalSaveResult = { goals: UserGoals; status: 'synced' | 'local-only'; syncError: boolean };
type StoredGoals = { goals: UserGoals; pending: boolean };
const isGoals = (value: unknown): value is UserGoals => {
    if (!value || typeof value !== 'object') return false;
    const goals = value as Partial<UserGoals>;
    return Number.isInteger(goals.weeklyGoal) && Number.isInteger(goals.clarityGoal)
        && Number(goals.weeklyGoal) >= 1 && Number(goals.weeklyGoal) <= 20
        && Number(goals.clarityGoal) >= 50 && Number(goals.clarityGoal) <= 100;
};
const readStoredGoals = (key: string): StoredGoals => {
    const cached = safeLocalStorageGetJSON<unknown>(key, null);
    if (isGoals(cached)) return { goals: cached, pending: false };
    if (cached && typeof cached === 'object') {
        const record = cached as Partial<StoredGoals>;
        if (isGoals(record.goals) && typeof record.pending === 'boolean') return { goals: record.goals, pending: record.pending };
    }
    return { goals: DEFAULT_GOALS, pending: false };
};
const storeGoals = (key: string, goals: UserGoals, pending: boolean) =>
    safeLocalStorageSet(key, JSON.stringify({ goals, pending }));

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
    const stored = readStoredGoals(storageKey);

    // 1. Fetcher with localStorage fallback
    const { data, isLoading } = useQuery({
        queryKey: ['userGoals', userId],
        queryFn: async ({ signal }): Promise<GoalSaveResult> => {
            const local = readStoredGoals(storageKey);
            if (!userId || local.pending) {
                return { goals: local.goals, status: 'local-only', syncError: Boolean(userId && local.pending) };
            }

            try {
                const remote = await goalsService.get(userId);
                if (remote) {
                    if (!signal.aborted) storeGoals(storageKey, remote, false);
                    return { goals: remote, status: 'synced', syncError: false };
                }
                return { goals: local.goals, status: 'local-only', syncError: false };
            } catch (err) {
                logger.info({ err }, '[useGoals] Account goal read unavailable');
                return { goals: local.goals, status: 'local-only', syncError: true };
            }
        },
        staleTime: 5 * 60 * 1000,
        retry: false,
        placeholderData: undefined,
    });
    const current: GoalSaveResult = data ?? { goals: stored.goals, status: 'local-only', syncError: Boolean(userId && stored.pending) };

    // 2. Mutation for updating goals
    const mutation = useMutation({
        mutationFn: async ({ newGoals, ownerId, key }: { newGoals: UserGoals; ownerId: string | undefined; key: string }): Promise<GoalSaveResult> => {
            storeGoals(key, newGoals, Boolean(ownerId));

            if (ownerId) {
                try {
                    return { goals: await goalsService.upsert(ownerId, newGoals), status: 'synced', syncError: false };
                } catch (err) {
                    logger.info({ err }, '[useGoals] Remote goal sync failed; keeping local goals');
                    return { goals: newGoals, status: 'local-only', syncError: true };
                }
            }
            return { goals: newGoals, status: 'local-only', syncError: false };
        },
        onSuccess: (settled, variables) => {
            const ownerId = variables.ownerId;
            storeGoals(variables.key, settled.goals, settled.syncError);
            queryClient.setQueryData(['userGoals', ownerId], settled);

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
        return settled;
    }, [mutation, userId, storageKey, queryClient]);

    const resetGoals = useCallback(async () => {
        await queryClient.cancelQueries({ queryKey: ['userGoals', userId], exact: true });
        safeLocalStorageRemove(storageKey);
        if (userId) {
            await mutation.mutateAsync({ newGoals: DEFAULT_GOALS, ownerId: userId, key: storageKey });
        } else {
            queryClient.setQueryData(['userGoals', undefined], { goals: DEFAULT_GOALS, status: 'local-only', syncError: false });
        }
    }, [userId, storageKey, mutation, queryClient]);

    return {
        ownerId: userId,
        goals: current.goals,
        setGoals,
        resetGoals,
        isLoading,
        syncError: current.syncError,
        defaultGoals: DEFAULT_GOALS,
    };
}

export { DEFAULT_GOALS };
