import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PauseDetector } from '../pauseDetector';

describe('PauseDetector', () => {
    let pauseDetector: PauseDetector;

    beforeEach(() => {
        vi.useFakeTimers();
        pauseDetector = new PauseDetector(0.1, 500); // threshold 0.1, min duration 500ms
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should initialize with default values', () => {
        const pd = new PauseDetector();
        expect(pd.getMetrics()).toEqual({
            totalPauses: 0,
            averagePauseDuration: 0,
            longestPause: 0,
            pausesPerMinute: 0,
            silencePercentage: 0,
            transitionPauses: 0,
            extendedPauses: 0,
        });
    });

    it('should detect silence start', () => {
        const silentFrame = new Float32Array(1024).fill(0);
        pauseDetector.processAudioFrame(silentFrame);
        // Internal state check not possible directly, but we can verify metrics didn't change wildly
        expect(pauseDetector.getMetrics().totalPauses).toBe(0);
    });

    it('should detect a valid pause', () => {
        const silentFrame = new Float32Array(1024).fill(0);
        const loudFrame = new Float32Array(1024).fill(0.5);

        // 1. Start silence
        pauseDetector.processAudioFrame(silentFrame);

        // 2. Wait for > 500ms
        vi.advanceTimersByTime(600);

        // 3. End silence (speech detected)
        pauseDetector.processAudioFrame(loudFrame);

        const metrics = pauseDetector.getMetrics();
        expect(metrics.totalPauses).toBe(1);
        expect(metrics.longestPause).toBeGreaterThanOrEqual(0.6); // 600ms
    });

    it('should ignore short silences', () => {
        const silentFrame = new Float32Array(1024).fill(0);
        const loudFrame = new Float32Array(1024).fill(0.5);

        // 1. Start silence
        pauseDetector.processAudioFrame(silentFrame);

        // 2. Wait for < 500ms
        vi.advanceTimersByTime(100);

        // 3. End silence
        pauseDetector.processAudioFrame(loudFrame);

        const metrics = pauseDetector.getMetrics();
        expect(metrics.totalPauses).toBe(0);
    });

    it('should reset state', () => {
        const silentFrame = new Float32Array(1024).fill(0);
        const loudFrame = new Float32Array(1024).fill(0.5);

        // Create a pause
        pauseDetector.processAudioFrame(silentFrame);
        vi.advanceTimersByTime(600);
        pauseDetector.processAudioFrame(loudFrame);

        expect(pauseDetector.getMetrics().totalPauses).toBe(1);

        pauseDetector.reset();

        expect(pauseDetector.getMetrics().totalPauses).toBe(0);
    });

    it('should calculate RMS correctly', () => {
        const pd = new PauseDetector(0.5, 500);

        // Frame with RMS < 0.5 (silence)
        const quietFrame = new Float32Array([0.1, 0.1, 0.1, 0.1]);
        pd.processAudioFrame(quietFrame);

        // Frame with RMS >= 0.5 (speech)
        const loudFrame = new Float32Array([0.6, 0.6, 0.6, 0.6]);

        // Wait enough time to register pause if quietFrame triggered it
        vi.advanceTimersByTime(600);

        pd.processAudioFrame(loudFrame);

        expect(pd.getMetrics().totalPauses).toBe(1);
    });
    it('REGRESSION: should adapt to a constant noise floor', () => {
        // 1. Send constant low-level noise (RMS ~0.2)
        // Initial threshold is 0.1, so this is "silent" relative to 0.1 BUT it would normally break silence.
        const loudNoiseFrame = new Float32Array(1024).fill(0.2);

        // Process many frames to fill the rolling window
        for (let i = 0; i < 60; i++) {
            pauseDetector.processAudioFrame(loudNoiseFrame);
        }

        // 2. The threshold should have adapted to be ~0.3 (0.2 * 1.5)
        // Now a frame at 0.25 (previously LOUD compared to default 0.1) should be "SILENT"
        pauseDetector.processAudioFrame(new Float32Array(1024).fill(0.25));
        vi.advanceTimersByTime(600);

        // 3. Send real speech (RMS ~0.5) to break the pause
        pauseDetector.processAudioFrame(new Float32Array(1024).fill(0.5));

        const metrics = pauseDetector.getMetrics();
        expect(metrics.totalPauses).toBe(1);
    });
});
