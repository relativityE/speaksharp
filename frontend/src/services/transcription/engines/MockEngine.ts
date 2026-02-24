import { Result } from 'true-myth';
import { IPrivateSTTEngine, EngineCallbacks, EngineType } from './IPrivateSTTEngine';
import logger from '../../../lib/logger';

/**
 * Industry Standard: Deterministic Mock Pattern
 * Reference: Jest, Playwright, Cypress mock patterns
 */
export class MockEngine implements IPrivateSTTEngine {
    public readonly type: EngineType = 'mock';
    private transcriptTimer: NodeJS.Timeout | null = null;
    private isTranscribing = false;
    private onTranscriptCallback: ((transcript: string, isFinal: boolean) => void) | null = null;

    // Configurable mock responses
    private readonly MOCK_TRANSCRIPT_SEQUENCE = [
        { transcript: 'Hello', delay: 500, isFinal: false },
        { transcript: 'Hello world', delay: 1000, isFinal: false },
        { transcript: 'Hello world this is a test', delay: 1500, isFinal: false },
        { transcript: 'Hello world this is a test transcript', delay: 2000, isFinal: true }
    ];

    async init(callbacks: EngineCallbacks): Promise<Result<void, Error>> {
        await this.initialize();
        if (callbacks.onReady) callbacks.onReady();
        return Result.ok(undefined);
    }

    async initialize(): Promise<void> {
        logger.info('[MockEngine] 🎭 Initializing mock engine for E2E testing');
        // Simulate async initialization
        await this.delay(100);
        logger.info('[MockEngine] ✅ Mock engine initialized');
    }

    async transcribe(_audio: Float32Array): Promise<Result<string, Error>> {
        // Return empty result as this mock uses callback-based emitter for realism
        return Result.ok('');
    }

    async startTranscription(
        onTranscript: (transcript: string, isFinal: boolean) => void
    ): Promise<void> {
        logger.info('[MockEngine] ▶️ Starting mock transcription');

        this.isTranscribing = true;
        this.onTranscriptCallback = onTranscript;

        // Emit transcript sequence
        let cumulativeDelay = 0;

        for (const segment of this.MOCK_TRANSCRIPT_SEQUENCE) {
            cumulativeDelay += segment.delay;

            this.transcriptTimer = setTimeout(() => {
                if (this.isTranscribing && this.onTranscriptCallback) {
                    logger.info({ transcript: segment.transcript, final: segment.isFinal }, '[MockEngine] 📝 Emitting');
                    this.onTranscriptCallback(segment.transcript, segment.isFinal);
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

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
