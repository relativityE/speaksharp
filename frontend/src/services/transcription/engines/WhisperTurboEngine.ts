/**
 * ============================================================================
 * WHISPER-TURBO ENGINE
 * ============================================================================
 * 
 * Fast path engine using whisper-turbo for Private STT.
 * Leverages WebGPU for hardware-accelerated inference.
 * 
 * This engine is:
 * - Very fast on GPU-capable hardware
 * - May fail in headless/CI environments
 * - Falls back to TransformersJSEngine on failure
 * 
 * @see docs/ARCHITECTURE.md - "Dual-Engine Private STT"
 */

import { Result } from 'true-myth';
import { SessionManager, AvailableModels, InferenceSession } from 'whisper-turbo';
import { IPrivateSTTEngine, EngineCallbacks, EngineType } from './IPrivateSTTEngine';
import { floatToWav } from '../utils/AudioProcessor';
import logger from '../../../lib/logger';

export class WhisperTurboEngine implements IPrivateSTTEngine {
    public readonly type: EngineType = 'whisper-turbo';
    private manager: SessionManager;
    private session: InferenceSession | null = null;

    constructor() {
        this.manager = new SessionManager();
    }

    async init(callbacks: EngineCallbacks, timeoutMs: number = 5000): Promise<Result<void, Error>> {
        logger.info('[WhisperTurbo] Initializing engine...');

        try {
            if (callbacks.onModelLoadProgress) {
                callbacks.onModelLoadProgress(0);
            }

            // Use Promise.race to implement a timeout
            const result = await Promise.race([
                this.manager.loadModel(
                    AvailableModels.WHISPER_TINY,
                    () => {
                        logger.info('[WhisperTurbo] Model loaded callback triggered.');
                    },
                    (progress: number) => {
                        if (callbacks.onModelLoadProgress) {
                            callbacks.onModelLoadProgress(progress);
                        }
                    }
                ),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error(`WhisperTurbo init timed out after ${timeoutMs}ms`)),
                        timeoutMs
                    )
                )
            ]);

            if (result.isErr) {
                return Result.err(result.error);
            }

            this.session = result.value;
            logger.info('[WhisperTurbo] Engine initialized successfully.');

            if (callbacks.onModelLoadProgress) {
                callbacks.onModelLoadProgress(100);
            }

            if (callbacks.onReady) {
                callbacks.onReady();
            }

            return Result.ok(undefined);
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[WhisperTurbo] Failed to initialize engine.');

            // Self-healing: Clear IndexedDB cache on failure to prevent permanent hang
            try {
                logger.info('[WhisperTurbo] Attempting self-healing cache clear...');
                const deleteRequest = indexedDB.deleteDatabase('whisper-turbo');
                deleteRequest.onsuccess = () => {
                    logger.info('[WhisperTurbo] Cache cleared successfully. Retry may succeed.');
                };
            } catch (cacheError) {
                logger.warn({ err: cacheError }, '[WhisperTurbo] Failed to clear cache.');
            }

            return Result.err(e);
        }
    }

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.session) {
            return Result.err(new Error('WhisperTurbo engine not initialized. Call init() first.'));
        }

        try {
            const wavData = floatToWav(audio);
            const result = await this.session.transcribe(wavData, false, {});

            if (result.isErr) {
                return Result.err(result.error);
            }

            return Result.ok(result.value.text || '');
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[WhisperTurbo] Transcription failed.');
            return Result.err(e);
        }
    }

    async destroy(): Promise<void> {
        logger.info('[WhisperTurbo] Destroying engine...');
        this.session = null;
    }
}
