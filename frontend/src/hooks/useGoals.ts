import { useState, useCallback, useEffect } from 'react';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { goalsService } from '@/services/domainServices';
import logger from '@/lib/logger';
import { GOALS_STORAGE_KEY, DEFAULT_GOALS } from '@/config/env';
import type { UserGoals } from '@/types/goal';

/**
 * Custom hook for managing user goals with Supabase sync and localStorage fallback.
 * 
 * P2-6 FIX: Uses goalsService domain service instead of direct Supabase calls.
 * 
 * - Authenticated users: Goals sync to Supabase `user_goals` table
 * - Unauthenticated/offline: Goals stored in localStorage only
 * - Defaults to 5 weekly sessions and 90% clarity if no goals are saved
 */
export function useGoals() {
    const { user } = useAuthProvider();
    const [goals, setGoalsState] = useState<UserGoals>(() => {
        if (typeof window === 'undefined') {
            return DEFAULT_GOALS;
        }
        try {
            const stored = localStorage.getItem(GOALS_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                return {
                    weeklyGoal: parsed.weeklyGoal ?? DEFAULT_GOALS.weeklyGoal,
                    clarityGoal: parsed.clarityGoal ?? DEFAULT_GOALS.clarityGoal,
                };
            }
        } catch {
            // Invalid JSON, use defaults
        }
        return DEFAULT_GOALS;
    });

    // Fetch goals from Supabase on mount if authenticated
    useEffect(() => {
        if (!user) return;

        const fetchGoals = async () => {
            try {
                const data = await goalsService.get(user.id);

                if (data) {
                    const supabaseGoals = {
                        weeklyGoal: data.weekly_goal,  // DB column name
                        clarityGoal: data.clarity_goal,
                    };
                    setGoalsState(supabaseGoals);
                    // Sync to localStorage
                    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(supabaseGoals));
                }
            } catch (err) {
                logger.error({ err }, '[useGoals] Failed to fetch goals');
                // Keep localStorage goals on error
            }
        };

        fetchGoals();
    }, [user]);

    const setGoals = useCallback(async (newGoals: UserGoals) => {
        setGoalsState(newGoals);

        // Always save to localStorage immediately
        try {
            localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(newGoals));
        } catch {
            // localStorage not available or full
        }

        // Sync to Supabase if authenticated
        if (user) {
            try {
                // P2-6 FIX: Use domain service
                await goalsService.upsert(user.id, {
                    weekly_goal: newGoals.weeklyGoal,  // DB column name
                    clarity_goal: newGoals.clarityGoal,
                });
            } catch (err) {
                logger.error({ err }, '[useGoals] Failed to sync goals');
            }
        }
    }, [user]);

    const resetGoals = useCallback(() => {
        setGoalsState(DEFAULT_GOALS);
        try {
            localStorage.removeItem(GOALS_STORAGE_KEY);
        } catch {
            // Ignore errors
        }
    }, []);

    return {
        goals,
        setGoals,
        resetGoals,
        defaultGoals: DEFAULT_GOALS,
    };
}

export { DEFAULT_GOALS };
