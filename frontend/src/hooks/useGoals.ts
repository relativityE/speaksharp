import { useState, useCallback } from 'react';

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
 * Custom hook for managing user goals with localStorage persistence.
 * 
 * Goals are stored in localStorage so they persist across sessions.
 * Defaults to 5 weekly sessions and 90% clarity if no goals are saved.
 */
export function useGoals() {
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

    const setGoals = useCallback((newGoals: UserGoals) => {
        setGoalsState(newGoals);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newGoals));
        } catch {
            // localStorage not available or full
        }
    }, []);

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
