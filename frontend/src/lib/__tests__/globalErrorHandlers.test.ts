import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupGlobalErrorHandlers, resetErrorState } from '../globalErrorHandlers';
import * as Sentry from '@sentry/react';
import { toast } from '@/lib/toast';
import logger from '../logger';

// Mock dependencies
vi.mock('@sentry/react', () => ({
    captureException: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
    toast: {
        error: vi.fn(),
    },
}));

vi.mock('../logger', () => ({
    default: {
        error: vi.fn(),
    },
}));

interface MockPromiseRejectionEvent extends Event {
    reason: Error;
    promise: Promise<unknown>;
}

describe('Global Error Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetErrorState();
        vi.useFakeTimers();
        setupGlobalErrorHandlers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should capture unhandledrejection in Sentry and show toast', () => {
        const reason = new Error('Async Failure');
        // Use custom interface to avoid PromiseRejectionEvent ReferenceError and ANY casts
        const event = new Event('unhandledrejection') as MockPromiseRejectionEvent;
        event.reason = reason;
        event.promise = Promise.resolve();

        window.dispatchEvent(event);

        expect(Sentry.captureException).toHaveBeenCalledWith(reason);
        expect(toast.error).toHaveBeenCalledWith('A background task failed', expect.objectContaining({
            description: 'Async Failure'
        }));
    });

    it('should debounce background failure toasts (Area 12)', () => {
        const event1 = new Event('unhandledrejection') as MockPromiseRejectionEvent;
        event1.reason = new Error('Failure 1');

        const event2 = new Event('unhandledrejection') as MockPromiseRejectionEvent;
        event2.reason = new Error('Failure 2');

        // First trigger
        window.dispatchEvent(event1);
        expect(toast.error).toHaveBeenCalledTimes(1);

        // Immediate second trigger
        window.dispatchEvent(event2);
        // Should NOT have called toast.error again due to 5s cooldown
        expect(toast.error).toHaveBeenCalledTimes(1);

        // Advance timers by 6 seconds
        vi.advanceTimersByTime(6000);

        // Third trigger
        window.dispatchEvent(event2);
        expect(toast.error).toHaveBeenCalledTimes(2);
    });

    it('should log uncaught errors to logger', () => {
        const error = new Error('Runtime Error');
        const event = new ErrorEvent('error', {
            error,
            message: 'Runtime Error',
            filename: 'test.js',
            lineno: 1,
        });

        window.dispatchEvent(event);

        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ error }),
            'Global Uncaught Error'
        );
    });
});
