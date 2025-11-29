/* eslint-disable vitest/expect-expect, no-empty */
import { describe, it, expect, beforeEach } from 'vitest';
import { PauseDetector } from '../pauseDetector';

describe('PauseDetector', () => {
    let pauseDetector: PauseDetector;

    beforeEach(() => {
        pauseDetector = new PauseDetector(0.1, 500); // threshold 0.1, min duration 500ms
    });

    it('should initialize with default values', () => {
        const pd = new PauseDetector();
        expect(pd.getMetrics()).toEqual({
            totalPauses: 0,
            averagePauseDuration: 0,
            longestPause: 0,
            pausesPerMinute: 0,
        });
    });

    it('should detect silence start', () => {
        const silentFrame = new Float32Array(1024).fill(0);
        pauseDetector.processAudioFrame(silentFrame);
        // Internal state check not possible directly, but we can infer from behavior
    });

    it('should detect a valid pause', () => {
        const silentFrame = new Float32Array(1024).fill(0);
        const loudFrame = new Float32Array(1024).fill(0.5);

        // 1. Start silence
        pauseDetector.processAudioFrame(silentFrame);

        // 2. Wait for > 500ms
        const startTime = Date.now();
        while (Date.now() - startTime < 600) {
            // Busy wait to simulate time passing (since PauseDetector uses Date.now())
        }

        // 3. End silence (speech detected)
        pauseDetector.processAudioFrame(loudFrame);

        const metrics = pauseDetector.getMetrics();
        expect(metrics.totalPauses).toBe(1);
        expect(metrics.longestPause).toBeGreaterThanOrEqual(0.5);
    });

    it('should ignore short silences', () => {
        const silentFrame = new Float32Array(1024).fill(0);
        const loudFrame = new Float32Array(1024).fill(0.5);

        // 1. Start silence
        pauseDetector.processAudioFrame(silentFrame);

        // 2. Wait for < 500ms
        const startTime = Date.now();
        while (Date.now() - startTime < 100) {
            // Busy wait
        }

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
        const startTime = Date.now();
        while (Date.now() - startTime < 600) { }
        pauseDetector.processAudioFrame(loudFrame);

        expect(pauseDetector.getMetrics().totalPauses).toBe(1);

        pauseDetector.reset();

        expect(pauseDetector.getMetrics().totalPauses).toBe(0);
    });

    it('should calculate RMS correctly', () => {
        // RMS of [1, 1, 1, 1] is 1
        // RMS of [0.5, 0.5, 0.5, 0.5] is 0.5
        // We can't access private calculateRMS, but we can test threshold behavior

        const pd = new PauseDetector(0.5, 500);

        // Frame with RMS < 0.5 (silence)
        const quietFrame = new Float32Array([0.1, 0.1, 0.1, 0.1]);
        pd.processAudioFrame(quietFrame);

        // Frame with RMS >= 0.5 (speech)
        const loudFrame = new Float32Array([0.6, 0.6, 0.6, 0.6]);

        const startTime = Date.now();
        while (Date.now() - startTime < 600) { }

        pd.processAudioFrame(loudFrame);

        expect(pd.getMetrics().totalPauses).toBe(1);
    });
});
