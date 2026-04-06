import { SttStatus } from '@/types/transcription';
import { TranscriptionModeOptions } from '@/services/transcription/modes/types';
import { useSessionStore } from '@/stores/useSessionStore';
import { calculateTranscriptStats } from '@/utils/fillerWordUtils';

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
    public state: string = 'IDLE';
    private sessionId: string = 'mock-session-id';
    private startTime: number = Date.now();
    private fsmSubscribers: Set<(state: string) => void> = new Set();
    public fsm = {
        subscribe: (cb: (state: string) => void) => {
            this.fsmSubscribers.add(cb);
            return () => this.fsmSubscribers.delete(cb);
        },
        getState: () => this.state,
        is: (state: string) => this.state === state,
    };

    private notifySubscribers() {
        this.fsmSubscribers.forEach(cb => cb(this.state));
    }

    // Callbacks provided by the hook
    private options: TranscriptionModeOptions;

    constructor(options: TranscriptionModeOptions) {
        if (!options) {
            console.error('[MockTranscriptionService] Constructor called without options!');
        }
        this.options = options || {} as TranscriptionModeOptions;
        MockTranscriptionService.latestInstance = this;
    }

    getState = () => this.state;
    updateCallbacks = (options: Partial<TranscriptionModeOptions>) => {
        this.options = { ...this.options, ...options };
    };

    // --- ITranscriptionService Interface Implementation ---

    init = async (): Promise<void> => {
        this.isReady = true;
        this.state = 'READY';
        this.notifySubscribers();
        this.options.onReady?.();
    }

    warmUp = async (mode: string): Promise<void> => {
        this.mode = mode as any;
        return Promise.resolve();
    }

    prepare = async (): Promise<void> => {
        this.state = 'READY';
        this.notifySubscribers();
        return Promise.resolve();
    }

    startTranscription = async (policy?: any): Promise<void> => {
        this.isListening = true;
        this.state = 'RECORDING';
        this.notifySubscribers();
        this.sttStatus = { type: 'ready', message: 'Recording active' };
        return Promise.resolve();
    }

    stopTranscription = async (): Promise<any> => {
        this.isListening = false;
        this.state = 'READY';
        this.notifySubscribers();

        const transcript = 'Test transcript final';
        const stats = calculateTranscriptStats([{ transcript }], [], '', 0);
        return { success: true, transcript, stats };
    }

    start = async (): Promise<void> => {
        await this.startTranscription();
    }

    stop = async (): Promise<void> => {
        await this.stopTranscription();
    }

    terminate = async (): Promise<void> => {
        this.isListening = false;
        return Promise.resolve();
    }

    destroy = async (): Promise<void> => {
        return this.terminate();
    }

    updatePolicy = vi.fn();

    resetEphemeralState(): void {
        this.isListening = false;
        this.error = null;
        this.sttStatus = { type: 'idle', message: 'Idle' };
    }

    getMode = () => this.mode;
    getEngineType = () => this.mode === 'private' ? 'whisper-turbo' : this.mode;

    getStrategy = (): any => {
        return {
            checkAvailability: async () => ({ isAvailable: true }),
            prepare: async () => {},
            start: async () => { this.isListening = true; },
            stop: async () => { this.isListening = false; },
            terminate: async () => { this.isListening = false; },
            getTranscript: async () => 'Test transcript',
            getLastHeartbeatTimestamp: () => Date.now(),
            getEngineType: () => this.mode
        };
    }

    dispose = (): void => {
        void this.terminate();
    }

    getLastHeartbeatTimestamp = (): number => {
        return Date.now();
    }

    getStartTime = () => this.startTime;
    setSessionId = (id: string) => { 
        this.sessionId = id;
        console.log('[DEBUG Mock] setSessionId:', id); 
    };
    getSessionId = () => this.sessionId;
    getMetadata = () => ({ engineVersion: '1.0.0', modelName: 'mock-model', deviceType: 'test' });

    getTranscript = async (): Promise<string> => {
        return "Current transcript";
    }

    // --- Test Helper Methods ---

    /**
     * Simulate a transcript update from the service.
     */
    simulateTranscript(transcript: string, isFinal: boolean = false): void {
        if (this.options.onTranscriptUpdate) {
            this.options.onTranscriptUpdate({
                transcript: isFinal
                    ? { final: transcript, partial: '' }
                    : { final: '', partial: transcript }
            });
        }
    }

    /**
     * Simulate an error occurring in the service.
     */
    simulateError(error: Error): void {
        this.error = error;
        this.sttStatus = { type: 'error', message: error.message };
        
        // Ensure store matches
        useSessionStore.getState().setSTTStatus(this.sttStatus);

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
        // Ensure store matches
        useSessionStore.getState().setSTTStatus(status);
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
