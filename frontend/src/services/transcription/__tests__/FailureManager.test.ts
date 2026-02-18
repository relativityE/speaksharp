import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FailureManager } from '../FailureManager';

describe('FailureManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        FailureManager.getInstance().resetFailureCount();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should be a singleton', () => {
        const instance1 = FailureManager.getInstance();
        const instance2 = FailureManager.getInstance();
        expect(instance1).toBe(instance2);
    });

    it('should initialize with zero failures', () => {
        const manager = FailureManager.getInstance();
        expect(manager.getEffectiveFailureCount()).toBe(0);
    });

    it('should record failures', () => {
        const manager = FailureManager.getInstance();
        manager.recordPrivateFailure();
        expect(manager.getEffectiveFailureCount()).toBe(1);
        manager.recordPrivateFailure();
        expect(manager.getEffectiveFailureCount()).toBe(2);
    });

    it('should decay failures after timeout', () => {
        const manager = FailureManager.getInstance();
        manager.recordPrivateFailure();
        expect(manager.getEffectiveFailureCount()).toBe(1);

        // Advance time by 5 minutes + 1ms
        vi.advanceTimersByTime(5 * 60 * 1000 + 1);

        expect(manager.getEffectiveFailureCount()).toBe(0);
    });

    it('should not decay failures before timeout', () => {
        const manager = FailureManager.getInstance();
        manager.recordPrivateFailure();
        expect(manager.getEffectiveFailureCount()).toBe(1);

        // Advance time by 4.9 minutes
        vi.advanceTimersByTime(4.9 * 60 * 1000);

        expect(manager.getEffectiveFailureCount()).toBe(1);
    });

    it('should persist state across calls', () => {
        const manager = FailureManager.getInstance();
        manager.recordPrivateFailure();

        // Simulate getting instance again elsewhere
        const manager2 = FailureManager.getInstance();
        expect(manager2.getEffectiveFailureCount()).toBe(1);
    });
});
