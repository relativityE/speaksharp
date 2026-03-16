import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FailureManager } from '../FailureManager';

describe('FailureManager', () => {
    let manager: FailureManager;

    beforeEach(() => {
        vi.useFakeTimers();
        manager = new FailureManager();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should initialize with zero failures', () => {
        expect(manager.getEffectiveFailureCount()).toBe(0);
    });

    it('should record failures', () => {
        manager.recordPrivateFailure();
        expect(manager.getEffectiveFailureCount()).toBe(1);
        manager.recordPrivateFailure();
        expect(manager.getEffectiveFailureCount()).toBe(2);
    });

    it('should decay failures after timeout', () => {
        manager.recordPrivateFailure();
        expect(manager.getEffectiveFailureCount()).toBe(1);

        // Advance time by 5 minutes + 1ms
        vi.advanceTimersByTime(5 * 60 * 1000 + 1);

        expect(manager.getEffectiveFailureCount()).toBe(0);
    });

    it('should not decay failures before timeout', () => {
        manager.recordPrivateFailure();
        expect(manager.getEffectiveFailureCount()).toBe(1);

        // Advance time by 4.9 minutes
        vi.advanceTimersByTime(4.9 * 60 * 1000);

        expect(manager.getEffectiveFailureCount()).toBe(1);
    });

    it('should maintain isolation between instances', () => {
        manager.recordPrivateFailure();
        const manager2 = new FailureManager();
        expect(manager2.getEffectiveFailureCount()).toBe(0);
        expect(manager.getEffectiveFailureCount()).toBe(1);
    });
});
