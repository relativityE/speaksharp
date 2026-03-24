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

    it('should EXPLICITLY reject if existing lock is in a failure state', () => {
        lock1.acquire('FAILED_VISIBLE');
        
        // Even if we wait a bit (but not past timeout), it should reject
        vi.advanceTimersByTime(1000);
        const acquired = lock2.acquire('RECORDING');
        expect(acquired).toBe(false);
    });
});
