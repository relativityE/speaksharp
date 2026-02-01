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

    it('should respect custom retry count (retries=1)', async () => {
        const mockFn = vi.fn().mockRejectedValue(new Error('always fails'));

        const promise = fetchWithRetry(mockFn, 1, 100);
        promise.catch(() => { }); // Prevent unhandled rejection

        await vi.runAllTimersAsync();

        await expect(promise).rejects.toThrow('always fails');
        // With retries=1, it should call once + 1 retry = 2 total
        expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should respect custom delay value', async () => {
        const mockFn = vi.fn()
            .mockRejectedValueOnce(new Error('fail'))
            .mockResolvedValue('success');

        const promise = fetchWithRetry(mockFn, 2, 500);

        await Promise.resolve();
        expect(mockFn).toHaveBeenCalledTimes(1);

        // Should not retry before 500ms
        await vi.advanceTimersByTime(499);
        expect(mockFn).toHaveBeenCalledTimes(1);

        // Should retry at 500ms
        await vi.advanceTimersByTime(1);
        await Promise.resolve();
        expect(mockFn).toHaveBeenCalledTimes(2);

        const result = await promise;
        expect(result).toBe('success');
    });

    it('should preserve original error message when all retries fail', async () => {
        const originalError = new Error('Specific API error: 503 Service Unavailable');
        const mockFn = vi.fn().mockRejectedValue(originalError);

        const promise = fetchWithRetry(mockFn, 1, 100);
        promise.catch(() => { });

        await vi.runAllTimersAsync();

        await expect(promise).rejects.toThrow('Specific API error: 503 Service Unavailable');
    });
});
