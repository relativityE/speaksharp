
import { TranscriptUpdate, SttStatus, TranscriptionServiceOptions } from '@/services/transcription/TranscriptionService';

export class MockTranscriptionService {
    // Static reference for tests to access the latest instance
    public static latestInstance: MockTranscriptionService | null = null;

    // Internal state
    public isListening = false;
    public isReady = true;
    public error: Error | null = null;
    public isSupported = true;
    public mode = 'native';
    public sttStatus: SttStatus = { type: 'idle', message: 'Idle' };

    // Callbacks provided by the hook
    private options: TranscriptionServiceOptions;

    constructor(options: TranscriptionServiceOptions) {
        this.options = options;
        MockTranscriptionService.latestInstance = this;
    }

    // --- ITranscriptionService Interface Implementation ---

    init = async (): Promise<{ success: boolean }> => {
        this.isReady = true;
        this.options.onReady?.();
        return Promise.resolve({ success: true });
    }

    startTranscription = async (): Promise<void> => {
        this.isListening = true;
        this.sttStatus = { type: 'ready', message: 'Recording active' };
        this.options.onStatusChange?.(this.sttStatus);
        return Promise.resolve();
    }

    stopTranscription = async (): Promise<{ transcript: string; duration: number }> => {
        this.isListening = false;

        // Return snapshot (solves stale closure)
        return {
            transcript: 'Test transcript final',
            duration: 120,
        };
    }

    destroy = async (): Promise<void> => {
        this.isListening = false;
        return Promise.resolve();
    }

    reset(): void {
        this.isListening = false;
        this.error = null;
        this.sttStatus = { type: 'idle', message: 'Idle' };
    }

    getMode = () => this.mode;

    getTranscript = async (): Promise<string> => {
        return "Current transcript";
    }

    // --- Test Helper Methods ---

    /**
     * Simulate a transcript update from the service.
     */
    simulateTranscript(text: string, isFinal: boolean = false): void {
        if (this.options.onTranscriptUpdate) {
            this.options.onTranscriptUpdate({
                transcript: isFinal
                    ? { final: text, partial: '' }
                    : { final: '', partial: text },
                chunks: isFinal ? [{ timestamp: [0, 100], text }] : []
            });
        }
    }

    /**
     * Simulate an error occurring in the service.
     */
    simulateError(error: Error): void {
        this.error = error;
        this.sttStatus = { type: 'error', message: error.message };
        this.options.onStatusChange?.(this.sttStatus);
    }

    /**
     * Simulate a status change (e.g., fallback, ready, error).
     */
    simulateStatusChange(status: SttStatus): void {
        this.sttStatus = status;
        this.options.onStatusChange?.(status);
    }
}
