import logger from '../../../lib/logger';
import {
    SpeechRuntimeState,
    SpeechRuntimeConfig,
    IEngineAdapter,
    EngineType
} from './types';
import { ModelLifecycleManager } from './ModelLifecycleManager';
import {
    PrivateEngineAdapter,
    NativeEngineAdapter,
    CloudEngineAdapter
} from './adapters/EngineAdapters';
import { TranscriptionMode, TranscriptionPolicy, resolveMode } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';
import { createMicStream } from '../utils/audioUtils';
import { TranscriptionModeOptions } from '../modes/types';

/**
 * SpeechRuntimeController
 *
 * The single source of truth for speech runtime state.
 * Orchestrates engine selection, model lifecycle, and privacy guarantees.
 */
export class SpeechRuntimeController {
    private state: SpeechRuntimeState = 'UNINITIALIZED';
    private config: SpeechRuntimeConfig;
    private modelManager: ModelLifecycleManager;
    private activeAdapter: IEngineAdapter | null = null;
    private mic: MicStream | null = null;
    private policy: TranscriptionPolicy;
    private options: TranscriptionModeOptions;

    constructor(config: SpeechRuntimeConfig, policy: TranscriptionPolicy, options: TranscriptionModeOptions) {
        this.config = config;
        this.policy = policy;
        this.options = options;
        this.modelManager = ModelLifecycleManager.getInstance();
        this.transition('UNINITIALIZED');
    }

    /**
     * Start the runtime process.
     */
    public async start(): Promise<void> {
        logger.info('[SpeechRuntimeController] Starting runtime...');

        try {
            // 1. Mic Acquisition
            if (!this.mic) {
                this.mic = await createMicStream({ sampleRate: 16000, frameSize: 1024 });
            }

            // 2. Resolve Mode and Check Model
            const mode = resolveMode(this.policy);
            this.transition('MODEL_CHECK');

            const isCached = await this.modelManager.isModelCached(mode);

            if (mode === 'private' && !isCached) {
                // Background download strategy
                this.transition('MODEL_DOWNLOADING');
                this.config.onEvent({ type: 'model_download_started', mode });

                // Switch to fallback if allowed while downloading
                if (this.policy.allowFallback) {
                    logger.info('[SpeechRuntimeController] Model missing, using fallback during download');
                    this.config.onEvent({
                        type: 'engine_fallback',
                        from: 'private',
                        to: 'native',
                        reason: 'Model downloading'
                    });
                    await this.activateEngine('native');
                }

                // Trigger download in background
                this.modelManager.loadModel(mode, (progress) => {
                    this.config.onEvent({ type: 'model_download_progress', mode, progress });
                }).then(async () => {
                    if (this.state === 'UNINITIALIZED' || this.state === 'CLEANING_UP') return;

                    this.config.onEvent({ type: 'model_ready', mode });

                    // AUTO-SWITCH: If we are currently in fallback mode, switch to private
                    if (this.state === 'RECORDING' && this.activeAdapter?.type === 'native') {
                        logger.info('[SpeechRuntimeController] Model ready, performing auto-switch to private');
                        await this.activateEngine('private');
                    }
                }).catch((error) => {
                    logger.error({ error }, '[SpeechRuntimeController] Background model load failed');
                    this.config.onEvent({ type: 'error', error: error instanceof Error ? error : new Error(String(error)) });
                });

            } else {
                await this.activateEngine(mode as EngineType);
            }

        } catch (error) {
            logger.error({ error }, '[SpeechRuntimeController] Start failed');
            this.transition('ERROR');
            this.config.onEvent({ type: 'error', error: error as Error });
        }
    }

    /**
     * Stop the runtime process.
     */
    public async stop(): Promise<string> {
        if (this.state !== 'RECORDING' && this.state !== 'PAUSED') return '';

        try {
            if (!this.activeAdapter) return '';
            const transcript = await this.activeAdapter.stop();
            this.transition('READY');
            return transcript;
        } catch (error) {
            this.transition('ERROR');
            throw error;
        }
    }

    /**
     * Pause the current recording.
     */
    public pause(): void {
        if (this.state !== 'RECORDING') return;
        this.transition('PAUSED');
        // Policy: We keep the mic and adapter hot, just stop processing frames
        // if the adapter supports it, or simply stop emitting updates.
    }

    /**
     * Resume the current recording.
     */
    public resume(): void {
        if (this.state !== 'PAUSED') return;
        this.transition('RECORDING');
    }

    /**
     * Terminate and cleanup.
     */
    public async terminate(): Promise<void> {
        this.transition('CLEANING_UP');
        if (this.mic) {
            this.mic.stop();
            this.mic = null;
        }
        if (this.activeAdapter) {
            await this.activeAdapter.dispose();
            this.activeAdapter = null;
        }
        this.transition('UNINITIALIZED');
    }

    private async activateEngine(type: EngineType): Promise<void> {
        if (this.state === 'CLEANING_UP' || this.state === 'UNINITIALIZED') return;

        if (this.activeAdapter && this.activeAdapter.type === type) {
            return;
        }

        if (this.activeAdapter) {
            await this.activeAdapter.dispose();
        }

        if (this.state === 'CLEANING_UP' || this.state === 'UNINITIALIZED') return;

        this.transition('MODEL_LOADING');

        switch (type) {
            case 'private': this.activeAdapter = new PrivateEngineAdapter(this.options); break;
            case 'native': this.activeAdapter = new NativeEngineAdapter(this.options); break;
            case 'cloud': this.activeAdapter = new CloudEngineAdapter(this.options); break;
            default: throw new Error(`Unsupported engine type: ${type}`);
        }

        await this.activeAdapter.initialize();

        if (this.state === 'CLEANING_UP' || this.state === 'UNINITIALIZED') return;

        this.transition('MODEL_WARMING');
        await this.modelManager.warmUp(type as TranscriptionMode);

        if (this.state === 'CLEANING_UP' || this.state === 'UNINITIALIZED') return;

        this.transition('READY');
        this.config.onEvent({ type: 'engine_activated', mode: type as TranscriptionMode });

        if (this.mic) {
            await this.activeAdapter.start(this.mic);
            if (this.state === 'READY') {
                this.transition('RECORDING');
            }
        }
    }

    private transition(newState: SpeechRuntimeState) {
        logger.info(`[SpeechRuntimeController] State: ${this.state} -> ${newState}`);
        this.state = newState;
        this.config.onStateChange(newState);
    }

    public getState(): SpeechRuntimeState {
        return this.state;
    }
}
