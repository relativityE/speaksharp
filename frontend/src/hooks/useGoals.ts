import { useState, useCallback, useEffect } from 'react';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { getSupabaseClient } from '@/lib/supabaseClient';

export interface UserGoals {
    weeklyGoal: number;
    clarityGoal: number;
}

const STORAGE_KEY = 'speaksharp:user-goals';
const DEFAULT_GOALS: UserGoals = {
    weeklyGoal: 5,
    clarityGoal: 90,
};

/**
 * Custom hook for managing user goals with Supabase sync and localStorage fallback.
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
            const stored = localStorage.getItem(STORAGE_KEY);
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
            const supabase = getSupabaseClient();
            try {
                const { data, error } = await supabase
                    .from('user_goals')
                    .select('weekly_goal, clarity_goal')
                    .eq('user_id', user.id)
                    .maybeSingle();

                if (error) {
                    console.error('[useGoals] Error fetching from Supabase:', error);
                    return; // Keep localStorage goals
                }

                if (data) {
                    const supabaseGoals = {
                        weeklyGoal: data.weekly_goal,
                        clarityGoal: data.clarity_goal,
                    };
                    setGoalsState(supabaseGoals);
                    // Sync to localStorage
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(supabaseGoals));
                }
            } catch (err) {
                console.error('[useGoals] Failed to fetch goals:', err);
            }
        };

        fetchGoals();
    }, [user]);

    const setGoals = useCallback(async (newGoals: UserGoals) => {
        setGoalsState(newGoals);

        // Always save to localStorage immediately
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newGoals));
        } catch {
            // localStorage not available or full
        }

        // Sync to Supabase if authenticated
        if (user) {
            const supabase = getSupabaseClient();
            try {
                const { error } = await supabase
                    .from('user_goals')
                    .upsert({
                        user_id: user.id,
                        weekly_goal: newGoals.weeklyGoal,
                        clarity_goal: newGoals.clarityGoal,
                    }, {
                        onConflict: 'user_id'
                    });

                if (error) {
                    console.error('[useGoals] Error syncing to Supabase:', error);
                }
            } catch (err) {
                console.error('[useGoals] Failed to sync goals:', err);
            }
        }
    }, [user]);

    const resetGoals = useCallback(() => {
        setGoalsState(DEFAULT_GOALS);
        try {
            localStorage.removeItem(STORAGE_KEY);
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
