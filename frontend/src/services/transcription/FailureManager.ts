// import { TranscriptionMode } from './TranscriptionPolicy';

/**
 * Track failures with timestamps for time-based decay.
 * Failures expire after FAILURE_DECAY_MS to prevent permanent lockout.
 */
const FAILURE_DECAY_MS = 5 * 60 * 1000; // 5 minutes

interface FailureRecord {
    count: number;
    lastFailureTime: number;
}

/**
 * Manages failure tracking for transcription modes using a Circuit Breaker pattern.
 * Now isolation-aware: One instance per TranscriptionService.
 */
export class FailureManager {
    private privateFailures: FailureRecord = { count: 0, lastFailureTime: 0 };

    public constructor() {
        // Now a public constructor for per-instance use
    }

    /**
     * Get effective failure count with time-based decay.
     * Failures older than FAILURE_DECAY_MS are ignored.
     */
    public getEffectiveFailureCount(): number {
        const now = Date.now();
        if (now - this.privateFailures.lastFailureTime > FAILURE_DECAY_MS) {
            // Failures have decayed, reset count
            this.privateFailures = { count: 0, lastFailureTime: 0 };
            return 0;
        }
        return this.privateFailures.count;
    }

    /**
     * Record a private mode failure with timestamp.
     */
    public recordPrivateFailure(): void {
        this.privateFailures = {
            count: this.getEffectiveFailureCount() + 1,
            lastFailureTime: Date.now()
        };
    }

    /**
     * Resets the failure count.
     */
    public resetFailureCount(): void {
        this.privateFailures = { count: 0, lastFailureTime: 0 };
    }

    public reset(): void {
        this.resetFailureCount();
    }
}
