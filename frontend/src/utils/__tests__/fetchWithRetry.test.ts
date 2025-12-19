import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from '../fetchWithRetry';

describe('fetchWithRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should return data on first successful attempt', async () => {
        const mockFn = vi.fn().mockResolvedValue('success');
        const result = await fetchWithRetry(mockFn);
        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
        const mockFn = vi.fn()
            .mockRejectedValueOnce(new Error('fail 1'))
            .mockRejectedValueOnce(new Error('fail 2'))
            .mockResolvedValue('success');

        const promise = fetchWithRetry(mockFn, 3, 100);

        // Wait for first failure
        await vi.runAllTimersAsync();

        const result = await promise;
        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should throw error after exhausting all retries', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('persistent failure'));

        // Handle rejection in-place to prevent Vitest global unhandled rejection
        const promise = fetchWithRetry(mockFn, 2, 100);
        const catchHandler = vi.fn();
        promise.catch(catchHandler);

        // Advance timers to trigger all retries
        for (let i = 0; i < 3; i++) {
            await vi.runOnlyPendingTimersAsync();
        }

        await expect(promise).rejects.toThrow('persistent failure');
        expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff timing', async () => {
        const mockFn = vi.fn()
            .mockRejectedValueOnce(new Error('fail 1'))
            .mockRejectedValueOnce(new Error('fail 2'))
            .mockResolvedValue('success');

        const promise = fetchWithRetry(mockFn, 3, 100);

        // Initial call fails immediately
        await Promise.resolve();
        expect(mockFn).toHaveBeenCalledTimes(1);

        // First retry should be after 100ms
        await vi.advanceTimersByTime(99);
        expect(mockFn).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTime(1);
        await Promise.resolve(); // Wait for microtasks after timer
        expect(mockFn).toHaveBeenCalledTimes(2);

        // Second retry should be after 200ms (100 * 2^1)
        await vi.advanceTimersByTime(199);
        expect(mockFn).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTime(1);
        await Promise.resolve();
        expect(mockFn).toHaveBeenCalledTimes(3);

        const result = await promise;
        expect(result).toBe('success');
    });
});
