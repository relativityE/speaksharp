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
import { TestFlags } from '../../../config/TestFlags';
import logger from '../../../lib/logger';

// Lazy-load transformers.js to avoid bundle bloat
type Pipeline = Awaited<ReturnType<typeof import('@xenova/transformers')['pipeline']>>;

export class TransformersJSEngine implements IPrivateSTTEngine {
    public readonly type: EngineType = 'transformers-js';
    private transcriber: Pipeline | null = null;

    async init(callbacks: EngineCallbacks): Promise<Result<void, Error>> {
        if (this.transcriber) {
            logger.info('[TransformersJS] Engine already initialized, skipping.');
            if (callbacks.onReady) callbacks.onReady();
            return Result.ok(undefined);
        }
        logger.info('[TransformersJS] Initializing engine...');

        try {
            // Lazy import transformers.js
            const transformers = await import('@xenova/transformers');
            const { pipeline, env } = transformers;

            if (TestFlags.DEBUG_ENABLED) {
                logger.debug({
                    hasPipeline: !!pipeline,
                    hasEnv: !!env,
                    allKeys: Object.keys(transformers)
                }, '[TransformersJS] Import check');
            }

            if (!env) {
                throw new Error('TransformersJS environment (env) is undefined. Check import logic.');
            }

            // Enable local models from the public directory
            env.allowLocalModels = true;
            env.localModelPath = '/models/';

            // Disable remote models to ensure CI/Local stability without CDN reliance
            env.allowRemoteModels = false;

            // Browser cache is only available in a real browser, not Happy-DOM/Node
            const isBrowser = typeof window !== 'undefined' &&
                typeof window.document !== 'undefined' &&
                !navigator.userAgent.includes('HappyDOM');

            env.useBrowserCache = isBrowser && !TestFlags.IS_TEST_MODE;

            if (TestFlags.DEBUG_ENABLED) {
                logger.debug({
                    isBrowser,
                    cacheEnabled: env.useBrowserCache,
                    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'none'
                }, '[TransformersJS] Env check');
            }

            // Report progress (transformers.js manages its own download progress callbacks)
            if (callbacks.onModelLoadProgress) {
                callbacks.onModelLoadProgress(0);
            }

            const loadStart = performance.now();
            this.transcriber = await pipeline(
                'automatic-speech-recognition',
                'whisper-tiny.en', // Use the local directory name in public/models/
                {
                    // Use quantized model for faster loading
                    quantized: true,
                    // Use main branch for latest model structure (onnx subfolder)
                    revision: 'main',
                    // Progress callback
                    progress_callback: (data: { progress?: number }) => {
                        if (callbacks.onModelLoadProgress && data.progress !== undefined) {
                            callbacks.onModelLoadProgress(data.progress);
                        }
                    }
                }
            );

            const loadTime = performance.now() - loadStart;
            logger.info({
                event: 'model_loaded',
                model: 'whisper-tiny.en',
                load_time_ms: Math.round(loadTime),
                engine: 'transformersjs',
            }, '[TransformersJS] Engine initialized successfully.');

            if (callbacks.onModelLoadProgress) {
                callbacks.onModelLoadProgress(100);
            }

            if (callbacks.onReady) {
                callbacks.onReady();
            }

            return Result.ok(undefined);
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));

            // Check for common SPA 404 error (HTML returned instead of JSON)
            if (e.message.includes("Unexpected token '<'") || e.message.includes("Unexpected token <")) {
                logger.error('[TransformersJS] ❌ Model load failed with "Unexpected token <". This suggests a 404 error where the server returned index.html instead of the model file. Ensure env.allowLocalModels=false is set.');
            }

            logger.error({ err: e }, '[TransformersJS] Failed to initialize engine.');
            return Result.err(e);
        }
    }

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.transcriber) {
            return Result.err(new Error('TransformersJS engine not initialized. Call init() first.'));
        }

        try {
            const start = performance.now();
            // transformers.js expects audio samples at 16kHz
            // The pipeline's call signature is complex; use a typed result interface
            interface TranscriptionResult {
                transcript?: string;
            }
            const result = await (this.transcriber as (audio: Float32Array, options: Record<string, unknown>) => Promise<string | TranscriptionResult>)(audio, {
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: false,
            });

            const latency = performance.now() - start;
            logger.info({
                event: 'inference_complete',
                latency_ms: Math.round(latency),
                audio_length_s: audio.length / 16000,
                engine: 'transformersjs'
            }, '[TransformersJS] Transcription complete.');

            // Extract transcript from result
            const transcript = typeof result === 'string'
                ? result
                : (result as TranscriptionResult).transcript ?? '';

            return Result.ok(transcript);
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
