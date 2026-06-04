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
import { redactTranscript } from '@/lib/logRedaction';
import { STTEngine } from '@/contracts/STTEngine';
import { PRIV_CLOUD_AUDIO, PRIV_STT, samplesToSeconds } from '../sttConstants';
import workerUrl from './transformers-js.worker.ts?worker&url';

// Lazy-load transformers.js to avoid bundle bloat
type Pipeline = Awaited<ReturnType<typeof import('@xenova/transformers')['pipeline']>>;
type UnknownRecord = Record<string, unknown>;
type WhisperDecodeOptions = Record<string, unknown>;
type WorkerRequest =
    | { type: 'init'; isE2E: boolean }
    | { type: 'transcribe'; audio: Float32Array; decodeOptions?: WhisperDecodeOptions }
    | { type: 'destroy' };
type WorkerResponse =
    | { id: number; type: 'ready' }
    | { id: number; type: 'progress'; progress: number }
    | { id: number; type: 'loaded'; loadTimeMs: number; model: string; device?: string; threads?: number; crossOriginIsolated?: boolean }
    | { id: number; type: 'result'; transcript: string; latencyMs: number; audioLengthSeconds: number; resultShape: string }
    | { id: number; type: 'destroyed' }
    | { id: number; type: 'error'; errorName: string; errorMessage: string };

type PendingWorkerRequest = {
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
};

interface TranscriptionResult {
    text?: string;
    transcript?: string;
}

declare global {
    interface Window {
        /**
         * Test/release proof hook only. Lets browser proofs A/B supported Whisper
         * generation options without changing product defaults. Ignored unless set.
         */
        __PRIVATE_STT_DECODE_OPTIONS__?: UnknownRecord;
    }
}

const isPrivateTranscriptTraceEnabled = () =>
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { __PRIVATE_TRANSCRIPT_TRACE__?: boolean }).__PRIVATE_TRANSCRIPT_TRACE__);

export const TRANSFORMERS_WORKER_REQUEST_TIMEOUT_MS = 120_000;

const ALLOWED_DECODE_OPTIONS = new Set([
    'return_timestamps',
    'condition_on_previous_text',
    'compression_ratio_threshold',
    'logprob_threshold',
    'no_speech_threshold',
    'no_repeat_ngram_size',
    'temperature',
]);

function readPrivateDecodeOptionsOverride(): WhisperDecodeOptions | undefined {
    if (typeof window === 'undefined') return undefined;
    const source = window.__PRIVATE_STT_DECODE_OPTIONS__;
    if (!source || typeof source !== 'object') return undefined;

    const out: WhisperDecodeOptions = {};
    for (const [key, value] of Object.entries(source)) {
        if (!ALLOWED_DECODE_OPTIONS.has(key)) continue;
        if (typeof value === 'boolean' || typeof value === 'number') {
            out[key] = value;
        } else if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
            out[key] = value;
        }
    }

    return Object.keys(out).length > 0 ? out : undefined;
}

function summarizeRawResult(result: unknown): UnknownRecord {
    if (typeof result === 'string') {
        return {
            kind: 'string',
            length: result.length,
            trimLength: result.trim().length,
            preview: redactTranscript(result),
        };
    }

    if (!result || typeof result !== 'object') {
        return {
            kind: result === null ? 'null' : typeof result,
        };
    }

    const record = result as UnknownRecord;
    const summary: UnknownRecord = {
        kind: 'object',
        keys: Object.keys(record).sort(),
    };

    for (const key of ['text', 'transcript', 'chunks', 'segments']) {
        const value = record[key];
        if (typeof value === 'string') {
            summary[key] = {
                type: 'string',
                length: value.length,
                trimLength: value.trim().length,
                preview: redactTranscript(value),
            };
        } else if (Array.isArray(value)) {
            summary[key] = { type: 'array', length: value.length };
        } else if (value !== undefined) {
            summary[key] = { type: typeof value };
        }
    }

    return summary;
}

export class TransformersJSEngine extends STTEngine {
    public readonly type: EngineType = 'transformers-js';
    private transcriber: Pipeline | null = null;
    private worker: Worker | null = null;
    private workerRequestId: number = 0;
    private pendingWorkerRequests = new Map<number, PendingWorkerRequest>();

    private async warmUpTranscriber(): Promise<void> {
        if (!this.transcriber || ENV.isTest || ENV.isE2E) return;

        const warmupAudio = new Float32Array(PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ);
        const options: Record<string, unknown> = {
            chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
            stride_length_s: 0,
            return_timestamps: false,
        };

        await (this.transcriber as (audio: Float32Array, options: Record<string, unknown>) => Promise<string | TranscriptionResult>)(warmupAudio, options);
    }

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
        if (this.transcriber || this.worker) {
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
            if (this.shouldUseWorker()) {
                await this.initWorker(isMock);
                if (options.onModelLoadProgress) {
                    options.onModelLoadProgress(100);
                }
                this.updateHeartbeat();
                options.onReady?.();
                return Result.ok(undefined);
            }

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

            const warmupStart = performance.now();
            await this.warmUpTranscriber();
            logger.info({
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                event: 'warmup_complete',
                latency_ms: Math.round(performance.now() - warmupStart),
                engine: 'transformersjs',
            }, '[TransformersJS] Engine warm-up complete.');

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
            const activeWorker = this.worker as Worker | null;
            if (activeWorker) {
                activeWorker.terminate();
                this.worker = null;
            }
            this.pendingWorkerRequests.forEach(({ reject, timeoutId }) => {
                clearTimeout(timeoutId);
                reject(e);
            });
            this.pendingWorkerRequests.clear();
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
        if (this.worker) {
            try {
                await this.sendWorkerRequest({ type: 'destroy' });
            } catch (error) {
                logger.warn({
                    sId: this.serviceId,
                    rId: this.runId,
                    eId: this.instanceId,
                    err: error,
                }, '[TransformersJS] Worker destroy request failed.');
            }
            this.worker.terminate();
            this.worker = null;
        }
        this.pendingWorkerRequests.forEach(({ reject, timeoutId }) => {
            clearTimeout(timeoutId);
            reject(new Error('TransformersJS worker destroyed.'));
        });
        this.pendingWorkerRequests.clear();
    }

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.transcriber && !this.worker) {
            return { isOk: false, error: new Error('TransformersJS engine not initialized. Call init() first.') };
        }

        this.updateHeartbeat(); // Standard contract: update heartbeat on activity

        try {
            if (this.worker) {
                const workerAudio = audio.slice(0);
                const decodeOptions = readPrivateDecodeOptionsOverride();
                const response = await this.sendWorkerRequest(
                    { type: 'transcribe', audio: workerAudio, decodeOptions },
                    [workerAudio.buffer],
                );
                if (response.type !== 'result') {
                    throw new Error(`Unexpected TransformersJS worker response: ${response.type}`);
                }

                logger.info({
                    sId: this.serviceId,
                    rId: this.runId,
                    eId: this.instanceId,
                    event: 'inference_complete',
                    latency_ms: response.latencyMs,
                    audio_length_s: response.audioLengthSeconds,
                    engine: 'transformersjs-worker',
                    result_shape: response.resultShape
                }, '[TransformersJS] Worker transcription complete.');

                if (isPrivateTranscriptTraceEnabled()) {
                    logger.info({
                        sId: this.serviceId,
                        rId: this.runId,
                        eId: this.instanceId,
                        audio_samples: audio.length,
                        audio_length_s: Number(response.audioLengthSeconds.toFixed(3)),
                        extracted_length: response.transcript.length,
                        extracted_trim_length: response.transcript.trim().length,
                        raw_result: {
                            kind: 'worker-result',
                            resultShape: response.resultShape,
                            preview: redactTranscript(response.transcript),
                        },
                    }, '[PRIVATE_DIAG] transformers_worker_result_shape');
                }

                this.currentTranscript = response.transcript;
                this.updateHeartbeat();
                return { isOk: true, data: response.transcript };
            }

            const start = performance.now();
            const audioLengthSeconds = samplesToSeconds(audio.length, PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ);
            const modelName = 'whisper-tiny.en';
            const isEnglishOnly = modelName.endsWith('.en');
            const options: Record<string, unknown> = {
                chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
                stride_length_s: audioLengthSeconds < PRIV_STT.WHISPER_WINDOW_SECONDS ? 0 : PRIV_STT.WHISPER_STRIDE_SECONDS,
                return_timestamps: true,
            };
            Object.assign(options, readPrivateDecodeOptionsOverride());
            if (!isEnglishOnly) {
                options.task = 'transcribe';
                options.language = 'english';
            }
            const result = await (this.transcriber as (audio: Float32Array, options: Record<string, unknown>) => Promise<string | TranscriptionResult>)(audio, options);

            const latency = performance.now() - start;
            logger.info({
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                event: 'inference_complete',
                latency_ms: Math.round(latency),
                audio_length_s: audioLengthSeconds,
                engine: 'transformersjs',
                result_shape: typeof result === 'string' ? 'string' : Object.keys(result).sort().join(',')
            }, '[TransformersJS] Transcription complete.');

            // Extract transcript from result
            const transcript = typeof result === 'string'
                ? result
                : (result as TranscriptionResult).text ?? (result as TranscriptionResult).transcript ?? '';

            if (isPrivateTranscriptTraceEnabled()) {
                logger.info({
                    sId: this.serviceId,
                    rId: this.runId,
                    eId: this.instanceId,
                    audio_samples: audio.length,
                    audio_length_s: Number(audioLengthSeconds.toFixed(3)),
                    extracted_length: transcript.length,
                    extracted_trim_length: transcript.trim().length,
                    raw_result: summarizeRawResult(result),
                }, '[PRIVATE_DIAG] transformers_result_shape');
            }

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

    private shouldUseWorker(): boolean {
        return typeof window !== 'undefined' &&
            typeof Worker !== 'undefined' &&
            typeof navigator !== 'undefined' &&
            !navigator.userAgent.includes('HappyDOM') &&
            !ENV.isTest;
    }

    private async initWorker(isMock?: boolean): Promise<void> {
        const options = (this.options || {}) as TranscriptionModeOptions;
        this.worker = new Worker(workerUrl, { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const response = event.data;
            if (response.type === 'progress') {
                options.onModelLoadProgress?.(response.progress);
                return;
            }

            if (response.type === 'loaded') {
                logger.info({
                    sId: this.serviceId,
                    rId: this.runId,
                    eId: this.instanceId,
                    event: 'model_loaded',
                    model: response.model,
                    load_time_ms: response.loadTimeMs,
                    engine: 'transformersjs-worker',
                    device: response.device,
                    threads: response.threads,
                    crossOriginIsolated: response.crossOriginIsolated,
                }, '[TransformersJS] Worker engine initialized successfully.');
                return;
            }

            const pending = this.pendingWorkerRequests.get(response.id);
            if (!pending) return;
            this.pendingWorkerRequests.delete(response.id);
            clearTimeout(pending.timeoutId);

            if (response.type === 'error') {
                pending.reject(new Error(response.errorMessage));
            } else {
                pending.resolve(response);
            }
        };
        this.worker.onerror = (event) => {
            const error = new Error(event.message || 'TransformersJS worker failed.');
            this.pendingWorkerRequests.forEach(({ reject, timeoutId }) => {
                clearTimeout(timeoutId);
                reject(error);
            });
            this.pendingWorkerRequests.clear();
        };

        const response = await this.sendWorkerRequest({ type: 'init', isE2E: Boolean(isMock) });
        if (response.type !== 'ready') {
            throw new Error(`Unexpected TransformersJS worker init response: ${response.type}`);
        }
    }

    private sendWorkerRequest(
        request: WorkerRequest,
        transfer?: Transferable[],
    ): Promise<WorkerResponse> {
        if (!this.worker) {
            return Promise.reject(new Error('TransformersJS worker is not available.'));
        }

        const id = ++this.workerRequestId;
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (!this.pendingWorkerRequests.has(id)) return;
                this.pendingWorkerRequests.delete(id);
                reject(new Error(`TransformersJS worker request timed out after ${TRANSFORMERS_WORKER_REQUEST_TIMEOUT_MS}ms (${request.type}).`));
            }, TRANSFORMERS_WORKER_REQUEST_TIMEOUT_MS);
            this.pendingWorkerRequests.set(id, { resolve, reject, timeoutId });
            this.worker?.postMessage({ id, ...request }, transfer ?? []);
        });
    }
}
