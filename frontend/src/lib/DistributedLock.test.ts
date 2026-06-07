import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DistributedLock } from './DistributedLock';

describe('DistributedLock', () => {
    let lock1: DistributedLock;
    let lock2: DistributedLock;

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        lock1 = new DistributedLock('tab-1');
        lock2 = new DistributedLock('tab-2');
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should allow acquisition when no lock exists', () => {
        const acquired = lock1.acquire('IDLE');
        expect(acquired).toBe(true);
        expect(lock1.getLock()?.tabId).toBe('tab-1');
    });

    it('should reject acquisition when another tab holds a fresh lock', () => {
        lock1.acquire('RECORDING');
        const acquired = lock2.acquire('RECORDING');
        expect(acquired).toBe(false);
    });

    it('should allow acquisition if the existing lock has timed out', () => {
        // Manually place an expired lock in localStorage (simulating a crashed tab)
        const expiredLock = {
            tabId: 'tab-crashed',
            timestamp: Date.now() - 10000, // 10s ago
            state: 'RECORDING'
        };
        localStorage.setItem('speaksharp_active_session_lock', JSON.stringify(expiredLock));
        
        const acquired = lock2.acquire('RECORDING');
        expect(acquired).toBe(true);
        expect(lock2.getLock()?.tabId).toBe('tab-2');
    });

    it('should update state metadata', () => {
        lock1.acquire('INITIATING');
        expect(lock1.getLock()?.state).toBe('INITIATING');
        
        lock1.updateState('RECORDING');
        expect(lock1.getLock()?.state).toBe('RECORDING');
    });

    it('should support heartbeat to keep lock alive', async () => {
        lock1.acquire('RECORDING');
        const initialTimestamp = lock1.getLock()?.timestamp || 0;
        
        // Advance time through one heartbeat interval (HEARTBEAT_INTERVAL = 2000)
        vi.advanceTimersByTime(2100);
        
        const lockAfterHeartbeat = lock1.getLock();
        expect(lockAfterHeartbeat?.timestamp).toBeGreaterThan(initialTimestamp);
    });

    it('should release lock cleanly', () => {
        lock1.acquire('RECORDING');
        lock1.updateState('TERMINATED');
        lock1.release();
        expect(lock1.getLock()).toBe(null);
        expect(localStorage.getItem('speaksharp_active_session_lock')).toBe(null);
    });

    it('stops heartbeat even when release rejects from a non-terminal state', () => {
        lock1.acquire('RECORDING');
        const timestampBeforeRelease = lock1.getLock()?.timestamp;

        expect(() => lock1.release()).toThrow(/Cannot release from state/);

        vi.advanceTimersByTime(4100);
        expect(lock1.getLock()?.timestamp).toBe(timestampBeforeRelease);
    });

    it('should EXPLICITLY reject if existing lock is in a failure state', () => {
        lock1.acquire('FAILED_VISIBLE');
        
        // Even if we wait a bit (but not past timeout), it should reject
        vi.advanceTimersByTime(1000);
        const acquired = lock2.acquire('RECORDING');
        expect(acquired).toBe(false);
    });
});

describe('DistributedLock — stable tab identity (LOCK-FALSE-POSITIVE)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        sessionStorage.clear();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('a reload (new instance, same tab/sessionStorage) recognizes its OWN fresh lock — no false "another tab"', () => {
        const before = new DistributedLock(); // no explicit tabId -> stable sessionStorage id
        expect(before.acquire('RECORDING')).toBe(true);

        // Simulate a hard reload: a brand-new instance in the SAME tab. sessionStorage persists, so
        // it must re-use the same identity and recognize the still-fresh lock as its own.
        const afterReload = new DistributedLock();
        expect(afterReload.getTabId()).toBe(before.getTabId());
        expect(afterReload.isHeldByOther()).toBe(false);
        expect(afterReload.acquire('RECORDING')).toBe(true); // recording can start; no false lockout
    });

    it('a genuinely different tab (separate sessionStorage) is still correctly blocked', () => {
        const tabA = new DistributedLock();
        tabA.acquire('RECORDING');

        // A different tab has its own sessionStorage namespace; emulate by clearing it.
        sessionStorage.clear();
        const tabB = new DistributedLock();
        expect(tabB.getTabId()).not.toBe(tabA.getTabId());
        expect(tabB.isHeldByOther()).toBe(true); // real cross-tab mutex preserved
        expect(tabB.acquire('RECORDING')).toBe(false);
    });
});
