import { Result } from 'true-myth';
import { IPrivateSTTEngine, EngineCallbacks, EngineType } from './IPrivateSTTEngine';
import { ITranscriptionEngine, TranscriptionModeOptions } from '../modes/types';
import { MicStream } from '../utils/types';
import logger from '../../../lib/logger';

/**
 * Industry Standard: Deterministic Mock Pattern
 * Reference: Jest, Playwright, Cypress mock patterns
 */
export class MockEngine implements ITranscriptionEngine, IPrivateSTTEngine {
    public readonly type: EngineType = 'mock';
    private transcriptTimer: NodeJS.Timeout | null = null;
    private isTranscribing = false;
    private onTranscriptCallback: ((transcript: string, isFinal: boolean) => void) | null = null;
    private options: TranscriptionModeOptions;
    private lastTranscript = '';

    // Configurable mock responses
    private readonly MOCK_TRANSCRIPT_SEQUENCE = [
        { transcript: 'Hello', delay: 500, isFinal: false },
        { transcript: 'Hello world', delay: 1000, isFinal: false },
        { transcript: 'Hello world this is a test', delay: 1500, isFinal: false },
        { transcript: 'Hello world this is a test transcript', delay: 2000, isFinal: true }
    ];

    constructor(options?: TranscriptionModeOptions) {
        this.options = options || {
            onTranscriptUpdate: () => {},
            onReady: () => {}
        };
    }

    /**
     * Unified init implementation using overloads to satisfy:
     * 1. ITranscriptionEngine: init(): Promise<void>
     * 2. IPrivateSTTEngine: init(callbacks: EngineCallbacks, timeoutMs?: number): Promise<Result<void, Error>>
     */
    async init(): Promise<void>;
    async init(callbacks: EngineCallbacks, timeoutMs?: number): Promise<Result<void, Error>>;
    async init(callbacks?: EngineCallbacks, _timeoutMs?: number): Promise<Result<void, Error> | void> {
        logger.info('[MockEngine] 🎭 Initializing mock engine for E2E testing');
        // Simulate async initialization
        await this.delay(100);
        logger.info('[MockEngine] ✅ Mock engine initialized');
        
        if (callbacks?.onReady) callbacks.onReady();
        if (this.options?.onReady) this.options.onReady();

        if (typeof callbacks === 'object' && callbacks !== null && 'onReady' in callbacks) {
          return Result.ok(undefined);
        }
    }

    async initialize(): Promise<void> {
        return this.init();
    }

    /**
     * IPrivateSTTEngine implementation
     */
    async transcribe(_audio: Float32Array): Promise<Result<string, Error>> {
        // Return empty result as this mock uses callback-based emitter for realism
        return Result.ok('');
    }

    /**
     * ITranscriptionEngine implementation
     */
    async startTranscription(_mic?: MicStream): Promise<void> {
        logger.info('[MockEngine] ▶️ Starting mock transcription');

        this.isTranscribing = true;

        // Emit transcript sequence
        let cumulativeDelay = 0;

        for (const segment of this.MOCK_TRANSCRIPT_SEQUENCE) {
            cumulativeDelay += segment.delay;

            this.transcriptTimer = setTimeout(() => {
                if (this.isTranscribing) {
                    this.lastTranscript = segment.transcript;
                    
                    if (this.onTranscriptCallback) {
                        logger.info({ transcript: segment.transcript, final: segment.isFinal }, '[MockEngine] 📝 Emitting via direct callback');
                        this.onTranscriptCallback(segment.transcript, segment.isFinal);
                    }
                    
                    // Also notify via options for integration tests
                    this.options.onTranscriptUpdate({
                        transcript: { [segment.isFinal ? 'final' : 'partial']: segment.transcript }
                    });
                }
            }, cumulativeDelay);
        }
    }

    async stopTranscription(): Promise<string> {
        logger.info('[MockEngine] ⏸️ Stopping mock transcription');

        this.isTranscribing = false;

        if (this.transcriptTimer) {
            clearTimeout(this.transcriptTimer);
            this.transcriptTimer = null;
        }

        const finalTranscript = this.MOCK_TRANSCRIPT_SEQUENCE[
            this.MOCK_TRANSCRIPT_SEQUENCE.length - 1
        ].transcript;

        return finalTranscript;
    }

    async destroy(): Promise<void> {
        logger.info('[MockEngine] 🗑️ Destroying mock engine');

        await this.stopTranscription();
        this.onTranscriptCallback = null;
    }

    async terminate(): Promise<void> {
        return this.destroy();
    }

    async getTranscript(): Promise<string> {
        return this.lastTranscript;
    }

    getEngineType(): string {
        return 'mock';
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
