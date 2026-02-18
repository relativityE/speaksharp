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
 * Implemented as a Singleton to persist state across TranscriptionService instantiations
 * (e.g., during navigation or component remounts).
 */
export class FailureManager {
    private static instance: FailureManager;
    private privateFailures: FailureRecord = { count: 0, lastFailureTime: 0 };

    private constructor() {
        // Private constructor for Singleton
    }

    public static getInstance(): FailureManager {
        if (!FailureManager.instance) {
            FailureManager.instance = new FailureManager();
        }
        return FailureManager.instance;
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
     * STRICTLY FOR TESTING PURPOSES ONLY.
     */
    public resetFailureCount(): void {
        this.privateFailures = { count: 0, lastFailureTime: 0 };
    }
}

// Expose to window for E2E tests
declare global {
    interface Window {
        __FAILURE_MANAGER__?: FailureManager;
    }
}

if (typeof window !== 'undefined') {
    window.__FAILURE_MANAGER__ = FailureManager.getInstance();
}
