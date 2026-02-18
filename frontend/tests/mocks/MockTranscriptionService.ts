import { SttStatus } from '@/types/transcription';
import { TranscriptionModeOptions } from '@/services/transcription/modes/types';

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
    private options: TranscriptionModeOptions;

    constructor(options: TranscriptionModeOptions) {
        if (!options) {
            console.error('[MockTranscriptionService] Constructor called without options!');
        }
        this.options = options || {} as TranscriptionModeOptions;
        MockTranscriptionService.latestInstance = this;
    }

    // --- ITranscriptionService Interface Implementation ---

    init = async (): Promise<void> => {
        this.isReady = true;
        this.options.onReady?.();
        return Promise.resolve();
    }

    startTranscription = async (): Promise<void> => {
        this.isListening = true;
        this.sttStatus = { type: 'ready', message: 'Recording active' };
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

    terminate = async (): Promise<void> => {
        this.isListening = false;
        return Promise.resolve();
    }

    reset(): void {
        this.isListening = false;
        this.error = null;
        this.sttStatus = { type: 'idle', message: 'Idle' };
    }

    getMode = () => this.mode;
    getEngineType = () => this.mode === 'private' ? 'whisper-turbo' : this.mode;

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
                    : { final: '', partial: text }
            });
        }
    }

    /**
     * Simulate an error occurring in the service.
     */
    simulateError(error: Error): void {
        this.error = error;
        this.sttStatus = { type: 'error', message: error.message };

        // Propagate via standard error callback if available (Issue C)
        if (this.options.onError) {
            this.options.onError({
                message: error.message,
                code: 'UNKNOWN',
                recoverable: false,
                name: 'TranscriptionError'
            } as unknown as import('@/services/transcription/modes/types').TranscriptionError);
        }
    }

    /**
     * Simulate a status change (e.g., fallback, ready, error).
     */
    simulateStatusChange(status: SttStatus): void {
        this.sttStatus = status;
        if (status.type === 'error' && this.options.onError) {
            this.options.onError({
                message: status.message,
                code: 'UNKNOWN',
                recoverable: false,
                name: 'TranscriptionError'
            } as unknown as import('@/services/transcription/modes/types').TranscriptionError);
        }
    }
}
