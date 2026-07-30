import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useHomeStreak } from '../useHomeStreak';
import * as storage from '@/lib/storage';
import type { PracticeStreak } from '@/lib/storage';

vi.mock('@/lib/storage', () => ({
    getPracticeStreak: vi.fn(),
    setUserTimezone: vi.fn().mockResolvedValue('UTC'),
}));

const active = (n: number): PracticeStreak => ({ state: 'active', count: n, lastQualifyingDate: null, timezone: 'UTC' });

describe('useHomeStreak (#1093 — account-keyed, stale-response protection)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('no user → not loading, no streak', () => {
        const { result } = renderHook(() => useHomeStreak(null));
        expect(result.current).toEqual({ streak: null, loading: false });
    });

    it('initializes the timezone once, then resolves the server streak', async () => {
        (storage.getPracticeStreak as ReturnType<typeof vi.fn>).mockResolvedValue(active(3));
        const { result } = renderHook(({ id }) => useHomeStreak(id), { initialProps: { id: 'user-a' } });
        expect(result.current.loading).toBe(true);
        expect(result.current.streak).toBeNull(); // never a premature value
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.streak).toEqual(active(3));
        expect(storage.setUserTimezone).toHaveBeenCalledTimes(1); // initialize-once per mount
    });

    it('on account switch: clears the prior result, shows loading, and IGNORES the prior account\'s stale response', async () => {
        // Account A: a response we control (does not resolve until we say so).
        let resolveA!: (v: PracticeStreak) => void;
        (storage.getPracticeStreak as ReturnType<typeof vi.fn>).mockImplementationOnce(
            () => new Promise<PracticeStreak>((r) => { resolveA = r; }),
        );
        const { result, rerender } = renderHook(({ id }) => useHomeStreak(id), { initialProps: { id: 'user-a' } });
        expect(result.current.loading).toBe(true);

        // Switch to account B before A resolves; B resolves normally.
        (storage.getPracticeStreak as ReturnType<typeof vi.fn>).mockResolvedValueOnce(active(7));
        rerender({ id: 'user-b' });
        expect(result.current.loading).toBe(true);   // prior result cleared, skeleton shown
        expect(result.current.streak).toBeNull();     // never account A's data during the switch
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.streak).toEqual(active(7)); // account B's result

        // Account A's stale response finally arrives — it must be ignored.
        await act(async () => { resolveA(active(999)); });
        expect(result.current.streak).toEqual(active(7)); // still B, never the stale A value
    });
});
