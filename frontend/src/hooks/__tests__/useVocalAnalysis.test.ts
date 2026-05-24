import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVocalAnalysis } from '../useVocalAnalysis';
import { PauseDetector } from '@/services/audio/pauseDetector';

const mockPauseDetectorInstance = {
    processAudioFrame: vi.fn(),
    getMetrics: vi.fn(() => ({
        totalPauses: 5,
        averagePauseDuration: 2.5,
        longestPause: 0,
        pausesPerMinute: 0,
        silencePercentage: 0,
        transitionPauses: 0,
        extendedPauses: 0,
    })),
    reset: vi.fn(),
    isMeaningfullySilent: vi.fn().mockReturnValue(false),
};

// Mock PauseDetector class
vi.mock('@/services/audio/pauseDetector', () => {
    return {
        PauseDetector: vi.fn(() => mockPauseDetectorInstance),
    };
});

describe('useVocalAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it('should initialize with isActive=false and empty metrics', () => {
        const { result } = renderHook(() => useVocalAnalysis());

        expect(result.current.pauseMetrics.totalPauses).toBe(0);
        // PauseDetector should not be instantiated yet
        expect(PauseDetector).not.toHaveBeenCalled();
    });

    it('should instantiate PauseDetector when setIsActive(true) is called', () => {
        const { result } = renderHook(() => useVocalAnalysis());

        act(() => {
            result.current.setIsActive(true);
        });

        expect(PauseDetector).toHaveBeenCalledTimes(1);
    });

    it('should update metrics when setIsActive(false) is called', () => {
        const { result } = renderHook(() => useVocalAnalysis());

        // Start
        act(() => {
            result.current.setIsActive(true);
        });

        // Stop
        act(() => {
            result.current.setIsActive(false);
        });

        // Should have called getMetrics and updated state
        expect(result.current.pauseMetrics.totalPauses).toBe(5);
        expect(result.current.pauseMetrics.averagePauseDuration).toBe(2.5);
    });

    it('should maintain the same PauseDetector instance across re-renders', () => {
        const { result, rerender } = renderHook(() => useVocalAnalysis());

        // Start
        act(() => {
            result.current.setIsActive(true);
        });
        expect(PauseDetector).toHaveBeenCalledTimes(1);

        // Force a re-render
        rerender();

        // Should still only be 1 instantiation
        expect(PauseDetector).toHaveBeenCalledTimes(1);
    });

    it('should detect clipping and set micWarning after 3 clipping frames', () => {
        const { result } = renderHook(() => useVocalAnalysis());

        act(() => {
            result.current.setIsActive(true);
        });

        // Frame 1
        act(() => {
            result.current.processAudioFrame(new Float32Array([1.0]));
        });
        expect(result.current.micWarning).toBeNull();

        // Frame 2
        act(() => {
            result.current.processAudioFrame(new Float32Array([1.0]));
        });
        expect(result.current.micWarning).toBeNull();

        // Frame 3
        act(() => {
            result.current.processAudioFrame(new Float32Array([1.0]));
        });
        expect(result.current.micWarning).toBe('Audio is clipping. Please speak further from the microphone.');
    });

    it('should detect low volume and set micWarning after 5 seconds', () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useVocalAnalysis());

        act(() => {
            result.current.setIsActive(true);
        });

        // First frame is processed
        act(() => {
            result.current.processAudioFrame(new Float32Array([0.0]));
        });
        expect(result.current.micWarning).toBeNull();

        // Advance timers by 5 seconds
        act(() => {
            vi.advanceTimersByTime(5000);
        });

        // Process another low volume frame
        act(() => {
            result.current.processAudioFrame(new Float32Array([0.0]));
        });

        expect(result.current.micWarning).toBe('Microphone volume too low.');
        vi.useRealTimers();
    });

    it('should detect hum and set micWarning when silent with high noise', () => {
        const { result } = renderHook(() => useVocalAnalysis());

        act(() => {
            result.current.setIsActive(true);
        });

        // Mock pause detector to report silence
        mockPauseDetectorInstance.isMeaningfullySilent.mockReturnValue(true);

        act(() => {
            // Process high RMS frame (RMS of constant [0.03] is 0.03 >= 0.025)
            result.current.processAudioFrame(new Float32Array([0.03]));
        });

        expect(result.current.micWarning).toBe('High background noise/hum detected.');
    });
});
