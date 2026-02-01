// Pause detection via audio amplitude analysis
// Detects silence gaps > 500ms as pauses

import { PAUSE_DETECTION } from '@/config';

export interface PauseMetrics {
    totalPauses: number;
    averagePauseDuration: number; // in seconds
    longestPause: number; // in seconds
    pausesPerMinute: number;
    silencePercentage: number;
    transitionPauses: number; // 0.5s - 1.5s
    extendedPauses: number;   // > 1.5s
}

export class PauseDetector {
    private baseThreshold: number;
    private silenceThreshold: number;
    private minPauseDuration: number;
    private pauses: { start: number; end: number }[] = [];
    private currentPauseStart: number | null = null;
    private isSilent: boolean = false;
    private sessionStartTime: number;
    private noiseFloor: number = 0.001; // Initial floor
    private rollingRMS: number[] = [];
    private readonly MAX_ROLLING_SAMPLES = 50; // ~5 seconds at 100ms updates

    constructor(
        silenceThreshold: number = PAUSE_DETECTION.SILENCE_THRESHOLD,
        minPauseDuration: number = PAUSE_DETECTION.MIN_PAUSE_DURATION_MS
    ) {
        this.baseThreshold = silenceThreshold;
        this.silenceThreshold = silenceThreshold;
        this.minPauseDuration = minPauseDuration;
        this.sessionStartTime = Date.now();
    }

    /**
     * Process audio frame and detect pauses
     */
    public processAudioFrame(audioData: Float32Array): void {
        const rms = this.calculateRMS(audioData);
        const now = Date.now();

        // Always track noise floor candidates
        this.updateNoiseFloor(rms);

        if (rms < this.silenceThreshold) {
            // Audio is silent relative to threshold
            if (!this.isSilent) {
                // Silence just started
                this.isSilent = true;
                this.currentPauseStart = now;
            }
        } else {
            // Audio is not silent (person is speaking)
            if (this.isSilent && this.currentPauseStart !== null) {
                // Silence just ended - check if it was long enough to be a pause
                const pauseDuration = now - this.currentPauseStart;
                if (pauseDuration >= this.minPauseDuration) {
                    this.pauses.push({
                        start: this.currentPauseStart,
                        end: now,
                    });
                }
                this.isSilent = false;
                this.currentPauseStart = null;
            }
        }
    }

    /**
     * Update the noise floor based on steady-state silence
     */
    private updateNoiseFloor(rms: number): void {
        this.rollingRMS.push(rms);
        if (this.rollingRMS.length > this.MAX_ROLLING_SAMPLES) {
            this.rollingRMS.shift();
        }

        // Noise floor is the minimum observed volume + a safety margin
        // We use the 10th percentile to avoid strictly following the absolute quietest spike
        const sorted = [...this.rollingRMS].sort((a, b) => a - b);
        const index = Math.floor(sorted.length * 0.1);
        const newFloor = sorted[index] || this.noiseFloor;

        // Slowly adapt 
        this.noiseFloor = this.noiseFloor * 0.9 + newFloor * 0.1;

        // Threshold is always at least the base threshold, or 50% above noise floor
        this.silenceThreshold = Math.max(this.baseThreshold, this.noiseFloor * 1.5);
    }

    /**
     * Calculate RMS (Root Mean Square) of audio signal
     */
    private calculateRMS(audioData: Float32Array): number {
        const sum = audioData.reduce((acc, val) => acc + val * val, 0);
        return Math.sqrt(sum / audioData.length);
    }

    /**
     * Get pause metrics
     */
    public getMetrics(): PauseMetrics {
        const sessionDurationSeconds = (Date.now() - this.sessionStartTime) / 1000;

        if (this.pauses.length === 0) {
            return {
                totalPauses: 0,
                averagePauseDuration: 0,
                longestPause: 0,
                pausesPerMinute: 0,
                silencePercentage: 0,
                transitionPauses: 0,
                extendedPauses: 0,
            };
        }

        const pauseDurations = this.pauses.map(p => (p.end - p.start) / 1000); // convert to seconds
        const totalPauseDuration = pauseDurations.reduce((sum, duration) => sum + duration, 0);

        const transitionPauses = pauseDurations.filter(d => d >= 0.5 && d <= 1.5).length;
        const extendedPauses = pauseDurations.filter(d => d > 1.5).length;

        const silencePercentage = sessionDurationSeconds > 0
            ? Math.min(100, (totalPauseDuration / sessionDurationSeconds) * 100)
            : 0;

        return {
            totalPauses: this.pauses.length,
            averagePauseDuration: totalPauseDuration / this.pauses.length,
            longestPause: Math.max(...pauseDurations),
            pausesPerMinute: (sessionDurationSeconds / 60) > 0 ? this.pauses.length / (sessionDurationSeconds / 60) : 0,
            silencePercentage,
            transitionPauses,
            extendedPauses,
        };
    }

    /**
     * Reset detector state
     */
    public reset(): void {
        this.pauses = [];
        this.currentPauseStart = null;
        this.isSilent = false;
        this.sessionStartTime = Date.now();
    }
}
