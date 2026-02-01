import { renderHook, act } from '@testing-library/react';
import { useStreak } from '../useStreak';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('useStreak', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    const setSystemTime = (dateStr: string) => {
        const date = new Date(dateStr + 'T12:00:00Z'); // Midday
        vi.setSystemTime(date);
        return date;
    };

    it('initializes with 0 streak', () => {
        const { result } = renderHook(() => useStreak());
        expect(result.current.currentStreak).toBe(0);
    });

    it('increments streak on first practice', () => {
        setSystemTime('2025-01-01');
        const { result } = renderHook(() => useStreak());

        act(() => {
            const update = result.current.updateStreak();
            expect(update.currentStreak).toBe(1);
            expect(update.isNewDay).toBe(true);
        });

        expect(result.current.currentStreak).toBe(1);
    });

    it('increments streak if practiced yesterday', () => {
        // Setup: practiced on Jan 1
        localStorage.setItem('speaksharp-streak', JSON.stringify({
            currentStreak: 1,
            lastPracticeDate: '2025-01-01'
        }));

        setSystemTime('2025-01-02');
        const { result } = renderHook(() => useStreak());

        act(() => {
            const update = result.current.updateStreak();
            expect(update.currentStreak).toBe(2);
            expect(update.isNewDay).toBe(true);
        });
    });

    it('does not increment if already practiced today', () => {
        localStorage.setItem('speaksharp-streak', JSON.stringify({
            currentStreak: 5,
            lastPracticeDate: '2025-01-05'
        }));

        setSystemTime('2025-01-05');
        const { result } = renderHook(() => useStreak());

        act(() => {
            const update = result.current.updateStreak();
            expect(update.currentStreak).toBe(5);
            expect(update.isNewDay).toBe(false);
        });
    });

    it('resets streak if missed a day', () => {
        localStorage.setItem('speaksharp-streak', JSON.stringify({
            currentStreak: 10,
            lastPracticeDate: '2025-01-01'
        }));

        setSystemTime('2025-01-03'); // Gap of one day (Jan 2 missed)
        const { result } = renderHook(() => useStreak());

        act(() => {
            const update = result.current.updateStreak();
            expect(update.currentStreak).toBe(1);
            expect(update.isNewDay).toBe(true);
        });
    });
});
