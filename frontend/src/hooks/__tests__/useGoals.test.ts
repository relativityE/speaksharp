import { renderHook, act, waitFor } from '@testing-library/react';
import { useGoals, DEFAULT_GOALS } from '../useGoals';
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { useAuthProvider } from '@/contexts/AuthProvider';
import { goalsService } from '@/services/domainServices';

// Mock dependencies
vi.mock('@/contexts/AuthProvider', () => ({
    useAuthProvider: vi.fn(),
}));

vi.mock('@/services/domainServices', () => ({
    goalsService: {
        get: vi.fn(),
        upsert: vi.fn(),
    },
}));

describe('useGoals', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetAllMocks();
        (useAuthProvider as Mock).mockReturnValue({ user: null });
    });

    it('initializes with default goals when no storage or user', () => {
        const { result } = renderHook(() => useGoals());
        expect(result.current.goals).toEqual(DEFAULT_GOALS);
    });

    it('initializes from localStorage if available', () => {
        const customGoals = { weeklyGoal: 10, clarityGoal: 95 };
        localStorage.setItem('speaksharp:user-goals', JSON.stringify(customGoals));

        const { result } = renderHook(() => useGoals());
        expect(result.current.goals).toEqual(customGoals);
    });

    it('fetches goals from Supabase when user is authenticated', async () => {
        const user = { id: 'user-123' };
        const supabaseGoals = { weekly_goal: 7, clarity_goal: 85 };
        (useAuthProvider as Mock).mockReturnValue({ user });
        (goalsService.get as Mock).mockResolvedValue(supabaseGoals);

        const { result } = renderHook(() => useGoals());

        await waitFor(() => {
            expect(result.current.goals).toEqual({
                weeklyGoal: 7,
                clarityGoal: 85,
            });
        });

        expect(goalsService.get).toHaveBeenCalledWith('user-123');
        expect(JSON.parse(localStorage.getItem('speaksharp:user-goals')!)).toEqual({
            weeklyGoal: 7,
            clarityGoal: 85,
        });
    });

    it('updates goals in localStorage and Supabase', async () => {
        const user = { id: 'user-123' };
        (useAuthProvider as Mock).mockReturnValue({ user });
        const { result } = renderHook(() => useGoals());

        const newGoals = { weeklyGoal: 3, clarityGoal: 98 };

        await act(async () => {
            await result.current.setGoals(newGoals);
        });

        expect(result.current.goals).toEqual(newGoals);
        expect(JSON.parse(localStorage.getItem('speaksharp:user-goals')!)).toEqual(newGoals);
        expect(goalsService.upsert).toHaveBeenCalledWith('user-123', {
            weekly_goal: 3,
            clarity_goal: 98,
        });
    });

    it('resets goals to defaults', () => {
        localStorage.setItem('speaksharp:user-goals', JSON.stringify({ weeklyGoal: 20, clarityGoal: 50 }));
        const { result } = renderHook(() => useGoals());

        act(() => {
            result.current.resetGoals();
        });

        expect(result.current.goals).toEqual(DEFAULT_GOALS);
        expect(localStorage.getItem('speaksharp:user-goals')).toBeNull();
    });
});
