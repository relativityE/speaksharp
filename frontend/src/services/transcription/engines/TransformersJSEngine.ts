/**
 * ============================================================================
 * TRANSFORMERS.JS ENGINE
 * ============================================================================
 * 
 * Safe fallback engine using @xenova/transformers for Private STT.
 * Uses ONNX Runtime with automatic CPU fallback when WebGPU is unavailable.
 * 
 * This engine is:
 * - More stable than whisper-turbo
 * - Works in CI/Playwright environments
 * - Slower but reliable on all hardware
 * 
 * @see docs/ARCHITECTURE.md - "Dual-Engine Private STT"
 */

import { Result } from 'true-myth';
import { IPrivateSTTEngine, EngineCallbacks, EngineType } from './IPrivateSTTEngine';
import logger from '../../../lib/logger';

// Lazy-load transformers.js to avoid bundle bloat
type Pipeline = Awaited<ReturnType<typeof import('@xenova/transformers')['pipeline']>>;

export class TransformersJSEngine implements IPrivateSTTEngine {
    public readonly type: EngineType = 'transformers-js';
    private transcriber: Pipeline | null = null;

    async init(callbacks: EngineCallbacks, _timeoutMs?: number): Promise<Result<void, Error>> {
        logger.info('[TransformersJS] Initializing engine...');

        try {
            // Lazy import transformers.js
            const { pipeline } = await import('@xenova/transformers');

            // Report progress (transformers.js manages its own download progress callbacks)
            if (callbacks.onModelLoadProgress) {
                callbacks.onModelLoadProgress(0);
            }

            // Initialize the ASR pipeline with Whisper tiny model
            this.transcriber = await pipeline(
                'automatic-speech-recognition',
                'Xenova/whisper-tiny.en',
                {
                    // Use quantized model for faster loading
                    quantized: true,
                    // Progress callback
                    progress_callback: (data: { progress?: number }) => {
                        if (callbacks.onModelLoadProgress && data.progress !== undefined) {
                            callbacks.onModelLoadProgress(data.progress);
                        }
                    }
                }
            );

            logger.info('[TransformersJS] Engine initialized successfully.');

            if (callbacks.onModelLoadProgress) {
                callbacks.onModelLoadProgress(100);
            }

            if (callbacks.onReady) {
                callbacks.onReady();
            }

            return Result.ok(undefined);
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[TransformersJS] Failed to initialize engine.');
            return Result.err(e);
        }
    }

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.transcriber) {
            return Result.err(new Error('TransformersJS engine not initialized. Call init() first.'));
        }

        try {
            // transformers.js expects audio samples at 16kHz
            // The pipeline's call signature is complex; use a typed result interface
            interface TranscriptionResult {
                text?: string;
            }
            const result = await (this.transcriber as (audio: Float32Array, options: Record<string, unknown>) => Promise<string | TranscriptionResult>)(audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: false,
            });

            // Extract text from result
            const text = typeof result === 'string'
                ? result
                : (result as TranscriptionResult).text ?? '';

            return Result.ok(text);
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ err: e }, '[TransformersJS] Transcription failed.');
            return Result.err(e);
        }
    }

    async destroy(): Promise<void> {
        logger.info('[TransformersJS] Destroying engine...');
        this.transcriber = null;
    }
}
