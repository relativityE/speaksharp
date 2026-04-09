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

import { Result, TranscriptionModeOptions } from '../../../services/transcription/modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';

import { ENV } from '../../../config/TestFlags';
import logger from '../../../lib/logger';
import { STTEngine } from '../../../contracts/STTEngine';

// Lazy-load transformers.js to avoid bundle bloat
type Pipeline = Awaited<ReturnType<typeof import('@xenova/transformers')['pipeline']>>;

export class TransformersJSEngine extends STTEngine {
    public readonly type: EngineType = 'transformers-js';
    private transcriber: Pipeline | null = null;

    constructor(options?: TranscriptionModeOptions) {
        super(options);
    }

    protected async onInit(_timeoutMs?: number): Promise<Result<void, Error>> {
        const options = this.options as TranscriptionModeOptions;
        if (this.transcriber) {
            logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJS] Engine already initialized, skipping.');
            if (options.onReady) options.onReady();
            return { isOk: true, data: undefined };
        }
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJS] Initializing engine...');

        try {
            // Lazy import transformers.js
            const transformers = await import('@xenova/transformers');
            const { pipeline, env } = transformers;

            if (ENV.debug) {
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

            env.useBrowserCache = isBrowser && !ENV.isE2E;

            if (ENV.debug) {
                logger.debug({
                    isBrowser,
                    cacheEnabled: env.useBrowserCache,
                    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'none'
                }, '[TransformersJS] Env check');
            }

            // Report progress (transformers.js manages its own download progress callbacks)
            if (options.onModelLoadProgress) {
                options.onModelLoadProgress(0);
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
                        if (options.onModelLoadProgress && data.progress !== undefined) {
                            options.onModelLoadProgress(data.progress);
                        }
                    }
                }
            );

            const loadTime = performance.now() - loadStart;
            logger.info({
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                event: 'model_loaded',
                model: 'whisper-tiny.en',
                load_time_ms: Math.round(loadTime),
                engine: 'transformersjs',
            }, '[TransformersJS] Engine initialized successfully.');

            if (options.onModelLoadProgress) {
                options.onModelLoadProgress(100);
            }

            if (options.onReady) {
                options.onReady();
            }

            return Result.ok(undefined);
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));

            // Check for common SPA 404 error (HTML returned instead of JSON)
            if (e.message.includes("Unexpected token '<'") || e.message.includes("Unexpected token <")) {
                logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJS] ❌ Model load failed with "Unexpected token <". This suggests a 404 error where the server returned index.html instead of the model file.');
            }

            logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, err: e }, '[TransformersJS] Failed to initialize engine.');
            return Result.err(e);
        }
    }

    protected async onStart(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, `[TransformersJS] Engine started at ${new Date().toISOString()}`);
    }

    protected async onStop(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJS] Stopping engine...');
    }

    public async pause(): Promise<void> {
        await this.onPause();
    }

    protected async onPause(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJS] Pausing engine...');
    }

    public async resume(): Promise<void> {
        await this.onResume();
    }

    protected async onResume(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJS] Resuming engine...');
    }

    protected async onDestroy(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJS] Destroying engine resources...');
        this.transcriber = null;
    }

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.transcriber) {
            return { isOk: false, error: new Error('TransformersJS engine not initialized. Call init() first.') };
        }

        this.updateHeartbeat(); // Standard contract: update heartbeat on activity

        try {
            const start = performance.now();
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
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                event: 'inference_complete',
                latency_ms: Math.round(latency),
                audio_length_s: audio.length / 16000,
                engine: 'transformersjs'
            }, '[TransformersJS] Transcription complete.');

            // Extract transcript from result
            const transcript = typeof result === 'string'
                ? result
                : (result as TranscriptionResult).transcript ?? '';

            this.currentTranscript = transcript; // Sync with orchestrator buffer
            this.updateHeartbeat();
            return { isOk: true, data: transcript };
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, err: e }, '[TransformersJS] Transcription failed.');
            return { isOk: false, error: e };
        }
    }

    async terminate(): Promise<void> {
        await this.destroy();
    }
}
