import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActiveSessionLock } from '../useActiveSessionLock';

describe('useActiveSessionLock', () => {

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('should acquire lock if no one holds it', () => {
        const { result } = renderHook(() => useActiveSessionLock());
        
        let acquired = false;
        act(() => {
            acquired = result.current.acquireLock();
        });

        expect(acquired).toBe(true);
        expect(result.current.isLockHeldByOther).toBe(false);

        // Verify localStorage was written
        const raw = localStorage.getItem('speaksharp_active_session_lock');
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw!);
        expect(parsed.tabId).toBe(result.current.tabId);
    });

    it('should show lock held by other if a valid lock exists in localStorage', () => {
        // Pre-populate a fake lock from another tab
        const otherTabLock = {
            tabId: 'some-other-tab',
            timestamp: Date.now()
        };
        localStorage.setItem('speaksharp_active_session_lock', JSON.stringify(otherTabLock));

        const { result } = renderHook(() => useActiveSessionLock());

        let acquired = false;
        act(() => {
            acquired = result.current.acquireLock();
        });

        // Current hook should NOT acquire it, and isLockHeldByOther should become true
        expect(acquired).toBe(false);
        expect(result.current.isLockHeldByOther).toBe(true);
    });

    it('should steal the lock if the existing lock is stale (timeout)', () => {
        const staleLock = {
            tabId: 'old-dead-tab',
            timestamp: Date.now() - 10000 // 10s old, exceeds the 5s timeout
        };
        localStorage.setItem('speaksharp_active_session_lock', JSON.stringify(staleLock));

        const { result } = renderHook(() => useActiveSessionLock());

        // We run checkLockStatus right away in mount, which should clear it
        let acquired;
        act(() => {
            acquired = result.current.acquireLock();
        });

        expect(acquired).toBe(true);
        expect(result.current.isLockHeldByOther).toBe(false);
    });

    it('should release the lock and clean up localStorage', () => {
        const { result } = renderHook(() => useActiveSessionLock());
        
        act(() => {
            result.current.acquireLock();
        });
        
        expect(localStorage.getItem('speaksharp_active_session_lock')).toBeTruthy();

        act(() => {
            result.current.releaseLock();
        });

        expect(localStorage.getItem('speaksharp_active_session_lock')).toBeNull();
    });

    it('should update timestamp on heartbeat interval', () => {
        const { result } = renderHook(() => useActiveSessionLock());

        act(() => {
            result.current.acquireLock();
        });

        const initialLock = JSON.parse(localStorage.getItem('speaksharp_active_session_lock')!);
        const initialTimestamp = initialLock.timestamp;

        // Advance timers by 2.5 seconds (interval is 2s)
        act(() => {
            vi.advanceTimersByTime(2500);
        });

        const updatedLock = JSON.parse(localStorage.getItem('speaksharp_active_session_lock')!);
        expect(updatedLock.timestamp).toBeGreaterThan(initialTimestamp);
    });
});
