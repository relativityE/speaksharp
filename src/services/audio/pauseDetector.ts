// Pause detection via audio amplitude analysis
// Detects silence gaps > 500ms as pauses

import { PAUSE_DETECTION } from '@/config';

export interface PauseMetrics {
    totalPauses: number;
    averagePauseDuration: number; // in seconds
    longestPause: number; // in seconds
    pausesPerMinute: number;
}

export class PauseDetector {
    private silenceThreshold: number;
    private minPauseDuration: number;
    private pauses: { start: number; end: number }[] = [];
    private currentPauseStart: number | null = null;
    private isSilent: boolean = false;
    private sessionStartTime: number;

    constructor(
        silenceThreshold: number = PAUSE_DETECTION.SILENCE_THRESHOLD,
        minPauseDuration: number = PAUSE_DETECTION.MIN_PAUSE_DURATION_MS
    ) {
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

        if (rms < this.silenceThreshold) {
            // Audio is silent
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
        const sessionDurationMinutes = (Date.now() - this.sessionStartTime) / 60000;

        if (this.pauses.length === 0) {
            return {
                totalPauses: 0,
                averagePauseDuration: 0,
                longestPause: 0,
                pausesPerMinute: 0,
            };
        }

        const pauseDurations = this.pauses.map(p => (p.end - p.start) / 1000); // convert to seconds
        const totalPauseDuration = pauseDurations.reduce((sum, duration) => sum + duration, 0);
        const averagePauseDuration = totalPauseDuration / this.pauses.length;
        const longestPause = Math.max(...pauseDurations);
        const pausesPerMinute = sessionDurationMinutes > 0 ? this.pauses.length / sessionDurationMinutes : 0;

        return {
            totalPauses: this.pauses.length,
            averagePauseDuration,
            longestPause,
            pausesPerMinute,
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
