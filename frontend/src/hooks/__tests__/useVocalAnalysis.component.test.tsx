import { renderHook, act } from '@testing-library/react';
import { useVocalAnalysis } from '../useVocalAnalysis';
import { PauseDetector } from '@/services/audio/pauseDetector';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Self-contained mock to avoid hoisting/transformation issues
vi.mock('@/services/audio/pauseDetector', () => {
    return {
        PauseDetector: vi.fn().mockImplementation(() => ({
            processAudioFrame: vi.fn(),
            getMetrics: vi.fn().mockReturnValue({
                totalPauses: 5,
                averagePauseDuration: 1.5,
                longestPause: 2.0,
                pausesPerMinute: 3.0,
                silencePercentage: 10,
                transitionPauses: 3,
                extendedPauses: 2,
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

    it('should initialize PauseDetector when setIsActive(true) is called', () => {
        const { result } = renderHook(() => useVocalAnalysis());

        expect(PauseDetector).not.toHaveBeenCalled();

        act(() => {
            result.current.setIsActive(true);
        });

        expect(PauseDetector).toHaveBeenCalledTimes(1);
    });

    it('should update metrics periodically when listening', () => {
        const { result } = renderHook(() => useVocalAnalysis());

        act(() => {
            result.current.setIsActive(true);
        });

        // Initial state
        expect(result.current.pauseMetrics.totalPauses).toBe(0);

        act(() => {
            vi.advanceTimersByTime(1001);
        });

        // Mocked state
        expect(result.current.pauseMetrics.totalPauses).toBe(5);
    });

    it('should reset metrics', () => {
        const { result } = renderHook(() => useVocalAnalysis());

        act(() => {
            result.current.setIsActive(true);
        });

        act(() => {
            vi.advanceTimersByTime(1001);
        });

        expect(result.current.pauseMetrics.totalPauses).toBe(5);

        act(() => {
            result.current.reset();
        });

        expect(result.current.pauseMetrics.totalPauses).toBe(0);
    });

    it('should process audio frames', () => {
        const { result } = renderHook(() => useVocalAnalysis());

        act(() => {
            result.current.setIsActive(true);
        });

        const audioData = new Float32Array([0.1, 0.2]);

        act(() => {
            result.current.processAudioFrame(audioData);
        });

        const mockInstance = vi.mocked(PauseDetector).mock.results[0].value;
        expect(mockInstance.processAudioFrame).toHaveBeenCalledWith(audioData);
    });
});
