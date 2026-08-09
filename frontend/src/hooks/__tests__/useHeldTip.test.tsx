import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useHeldTip } from '../useHeldTip';

interface Tip { id: string; text: string }
const tip = (id: string): Tip => ({ id, text: id });

// #1222 §4 — one tip at a time, held ≥8s, and the LATEST candidate wins when the hold expires.
describe('useHeldTip (#1222 §4 — 8s minimum hold)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });
    afterEach(() => vi.useRealTimers());

    it('adopts the first tip immediately', () => {
        const { result } = renderHook(({ c }) => useHeldTip(c, 8000), { initialProps: { c: tip('a') } });
        expect(result.current?.id).toBe('a');
    });

    it('holds the current tip for the full 8s before swapping', () => {
        const { result, rerender } = renderHook(({ c }) => useHeldTip(c, 8000), { initialProps: { c: tip('a') } });
        expect(result.current?.id).toBe('a');

        // A new tip arrives at t=3s — must NOT replace 'a' yet.
        act(() => { vi.setSystemTime(3000); });
        rerender({ c: tip('b') });
        expect(result.current?.id).toBe('a');

        // Advance to just before 8s — still 'a'.
        act(() => { vi.setSystemTime(7999); vi.advanceTimersByTime(4999); });
        expect(result.current?.id).toBe('a');

        // Cross 8s — now 'b' takes over.
        act(() => { vi.setSystemTime(8000); vi.advanceTimersByTime(1); });
        expect(result.current?.id).toBe('b');
    });

    it('when the hold expires the LATEST candidate wins, not a stale queued one', () => {
        const { result, rerender } = renderHook(({ c }) => useHeldTip(c, 8000), { initialProps: { c: tip('a') } });
        act(() => { vi.setSystemTime(2000); });
        rerender({ c: tip('b') }); // queued during hold
        act(() => { vi.setSystemTime(5000); });
        rerender({ c: tip('c') }); // supersedes 'b' during hold
        act(() => { vi.setSystemTime(8000); vi.advanceTimersByTime(8000); });
        expect(result.current?.id).toBe('c');
    });

    it('a candidate with the same id never resets the hold or re-renders a swap', () => {
        const { result, rerender } = renderHook(({ c }) => useHeldTip(c, 8000), { initialProps: { c: tip('a') } });
        act(() => { vi.setSystemTime(4000); });
        rerender({ c: { id: 'a', text: 'a-updated' } });
        expect(result.current?.id).toBe('a');
    });

    it('never blanks mid-session when the candidate clears to null', () => {
        const { result, rerender } = renderHook(({ c }) => useHeldTip(c, 8000), { initialProps: { c: tip('a') as Tip | null } });
        act(() => { vi.setSystemTime(9000); });
        rerender({ c: null });
        expect(result.current?.id).toBe('a'); // keeps the last tip visible
    });
});
