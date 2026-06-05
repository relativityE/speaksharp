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



interface MockPromiseRejectionEvent extends Event {
    reason: Error;
    promise: Promise<unknown>;
    preventDefault: ReturnType<typeof vi.fn>;
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

    it('should capture unhandledrejection in Sentry and show a generic toast (no raw message leak)', () => {
        const reason = new Error('Async Failure: secret-internal-db-detail');
        // Use custom interface to avoid PromiseRejectionEvent ReferenceError and ANY casts
        const event = new Event('unhandledrejection') as MockPromiseRejectionEvent;
        event.reason = reason;
        event.promise = Promise.resolve();
        event.preventDefault = vi.fn();

        window.dispatchEvent(event);

        // Raw reason still flows to Sentry (internal observability)...
        expect(Sentry.captureException).toHaveBeenCalledWith(reason);
        // ...but the user-facing toast must be generic and MUST NOT echo the raw error message.
        expect(toast.error).toHaveBeenCalledTimes(1);
        const [title, opts] = (toast.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(title).not.toContain('Async Failure');
        expect(String((opts as { description?: string })?.description ?? '')).not.toContain('Async Failure');
        expect(event.preventDefault).toHaveBeenCalled();
    });

    it('should debounce background failure toasts (Area 12)', () => {
        const event1 = new Event('unhandledrejection') as MockPromiseRejectionEvent;
        event1.reason = new Error('Failure 1');
        event1.preventDefault = vi.fn();

        const event2 = new Event('unhandledrejection') as MockPromiseRejectionEvent;
        event2.reason = new Error('Failure 2');
        event2.preventDefault = vi.fn();

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

    it('should suppress benign abort rejections without user-facing noise', () => {
        const reason = new DOMException('The operation was aborted.', 'AbortError');
        const event = new Event('unhandledrejection') as MockPromiseRejectionEvent;
        event.reason = reason as unknown as Error;
        event.promise = Promise.resolve();
        event.preventDefault = vi.fn();

        window.dispatchEvent(event);

        expect(Sentry.captureException).not.toHaveBeenCalled();
        expect(toast.error).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalled();
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
