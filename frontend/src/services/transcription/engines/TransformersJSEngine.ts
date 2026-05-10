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

import { Result, TranscriptionModeOptions } from '@/services/transcription/modes/types';
import { EngineType } from '@/contracts/IPrivateSTTEngine';
import { MicStream } from '@/services/transcription/utils/types';

import { ENV } from '@/config/TestFlags';
import logger from '@/lib/logger';
import { STTEngine } from '@/contracts/STTEngine';

// Lazy-load transformers.js to avoid bundle bloat
type Pipeline = Awaited<ReturnType<typeof import('@xenova/transformers')['pipeline']>>;

export class TransformersJSEngine extends STTEngine {
    public readonly type: EngineType = 'transformers-js';
    private transcriber: Pipeline | null = null;

    constructor(options?: TranscriptionModeOptions) {
        super(options);
    }

    protected override async onInit(): Promise<Result<void, Error>> {
        const result = await this.loadModel(ENV.isE2E);
        if (!result.isOk) return result;
        
        (this.options as TranscriptionModeOptions).onReady?.();
        return Result.ok(undefined);
    }

    protected async loadModel(isMock?: boolean): Promise<Result<void, Error>> {
        const options = (this.options || {}) as TranscriptionModeOptions;
        if (this.transcriber) {
            logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJS] Engine already initialized, skipping.');
            if (options.onReady) options.onReady();
            return Result.ok(undefined);
        }
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJS] Initializing engine...');
        
        if (isMock) {
            logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJS] 🧪 Mock mode detected - bypassing heavy initialization');
            if (options.onReady) options.onReady();
            return Result.ok(undefined);
        }

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

            // Prefer bundled assets, but allow a production Hugging Face fallback if the
            // local model bundle is missing or corrupt.
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

            const progress_callback = (data: { progress?: number }) => {
                if (options.onModelLoadProgress && data.progress !== undefined) {
                    options.onModelLoadProgress(data.progress);
                }
            };

            const loadStart = performance.now();
            try {
                this.transcriber = await pipeline(
                    'automatic-speech-recognition',
                    'whisper-tiny.en', // Use the local directory name in public/models/
                    {
                        // Use quantized model for faster loading
                        quantized: true,
                        // Use main branch for latest model structure (onnx subfolder)
                        revision: 'main',
                        progress_callback
                    }
                );
            } catch (localError) {
                if (ENV.isE2E) {
                    throw localError;
                }

                logger.warn({
                    sId: this.serviceId,
                    rId: this.runId,
                    eId: this.instanceId,
                    errorName: localError instanceof Error ? localError.name : typeof localError,
                    errorMessage: localError instanceof Error ? localError.message : String(localError),
                }, '[TransformersJS] Local model load failed. Retrying from Hugging Face.');

                env.allowRemoteModels = true;
                this.transcriber = await pipeline(
                    'automatic-speech-recognition',
                    'Xenova/whisper-tiny.en',
                    {
                        quantized: true,
                        revision: 'main',
                        progress_callback
                    }
                );
            }

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

            this.updateHeartbeat();

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

            logger.error({
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                errorName: e.name,
                errorMessage: e.message,
            }, '[TransformersJS] Failed to initialize engine.');
            return Result.err(e);
        }
    }

    protected async onStart(_mic?: MicStream, userWords: string[] = []): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, userWordsCount: userWords.length }, `[TransformersJS] Engine started at ${new Date().toISOString()}`);
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
                text?: string;
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
                engine: 'transformersjs',
                result_shape: typeof result === 'string' ? 'string' : Object.keys(result).sort().join(',')
            }, '[TransformersJS] Transcription complete.');

            // Extract transcript from result
            const transcript = typeof result === 'string'
                ? result
                : (result as TranscriptionResult).text ?? (result as TranscriptionResult).transcript ?? '';

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
