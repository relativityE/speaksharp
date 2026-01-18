import { renderHook, act } from '@testing-library/react';
import { useVocalAnalysis } from '../useVocalAnalysis';
import { PauseDetector } from '@/services/audio/pauseDetector';
/* removed disable */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock PauseDetector
vi.mock('@/services/audio/pauseDetector', () => {
    return {
        PauseDetector: vi.fn().mockImplementation(() => ({
            processAudioFrame: vi.fn(),
            getMetrics: vi.fn().mockReturnValue({
                totalPauses: 5,
                averagePauseDuration: 1.5,
                longestPause: 2.0,
                pausesPerMinute: 3.0,
            }),
            reset: vi.fn(),
        })),
    };
});

describe('useVocalAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should initialize PauseDetector when listening starts', () => {
        const { rerender } = renderHook(({ isListening }) => useVocalAnalysis(isListening), {
            initialProps: { isListening: false },
        });

        expect(PauseDetector).not.toHaveBeenCalled();

        rerender({ isListening: true });

        expect(PauseDetector).toHaveBeenCalledTimes(1);
    });

    it('should update metrics periodically when listening', () => {
        const { result } = renderHook(() => useVocalAnalysis(true));

        expect(result.current.pauseMetrics).toEqual({
            totalPauses: 0,
            averagePauseDuration: 0,
            longestPause: 0,
            pausesPerMinute: 0,
        });

        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(result.current.pauseMetrics).toEqual({
            totalPauses: 5,
            averagePauseDuration: 1.5,
            longestPause: 2.0,
            pausesPerMinute: 3.0,
        });
    });

    it('should reset metrics', () => {
        const { result } = renderHook(() => useVocalAnalysis(true));

        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(result.current.pauseMetrics.totalPauses).toBe(5);

        act(() => {
            result.current.reset();
        });

        expect(result.current.pauseMetrics).toEqual({
            totalPauses: 0,
            averagePauseDuration: 0,
            longestPause: 0,
            pausesPerMinute: 0,
        });
    });

    it('should process audio frames', () => {
        const { result } = renderHook(() => useVocalAnalysis(true));
        const audioData = new Float32Array([0.1, 0.2]);

        expect(() => {
            result.current.processAudioFrame(audioData);
        }).not.toThrow();
    });
});
