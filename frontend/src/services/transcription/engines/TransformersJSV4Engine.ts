/**
 * ============================================================================
 * TRANSFORMERS.JS V4 ENGINE
 * ============================================================================
 *
 * Side-by-side Private STT candidate using @huggingface/transformers v4.
 * It intentionally preserves the current device strategy: browser CPU/WASM by
 * default, with no WebGPU promotion in this wrapper.
 */

import { Result, TranscriptionModeOptions } from '@/services/transcription/modes/types';
import { EngineType } from '@/contracts/IPrivateSTTEngine';
import { MicStream } from '@/services/transcription/utils/types';

import { ENV } from '@/config/TestFlags';
import logger from '@/lib/logger';
import { STTEngine } from '@/contracts/STTEngine';
import { PRIV_CLOUD_AUDIO, PRIV_STT, PRIV_STT_V4, samplesToSeconds } from '../sttConstants';
import v4WorkerUrl from './transformers-js-v4.worker.ts?worker&url';

type Pipeline = Awaited<ReturnType<typeof import('@huggingface/transformers')['pipeline']>>;
type UnknownRecord = Record<string, unknown>;
type WorkerResponse =
    | { id: number; type: 'ready' }
    | { id: number; type: 'progress'; progress: number }
    | { id: number; type: 'loaded'; loadTimeMs: number; model: string; device: string }
    | { id: number; type: 'warmed'; warmupMs: number }
    | { id: number; type: 'result'; transcript: string; latencyMs: number; audioLengthSeconds: number; resultShape: string }
    | { id: number; type: 'destroyed' }
    | { id: number; type: 'error'; errorName: string; errorMessage: string };

type PendingWorkerRequest = {
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
};

const isPrivateTranscriptTraceEnabled = () =>
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { __PRIVATE_TRANSCRIPT_TRACE__?: boolean }).__PRIVATE_TRANSCRIPT_TRACE__);

function summarizeRawResult(result: unknown): UnknownRecord {
    if (typeof result === 'string') {
        return {
            kind: 'string',
            length: result.length,
            trimLength: result.trim().length,
            preview: result.slice(0, 120),
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
                preview: value.slice(0, 120),
            };
        } else if (Array.isArray(value)) {
            summary[key] = { type: 'array', length: value.length };
        } else if (value !== undefined) {
            summary[key] = { type: typeof value };
        }
    }

    return summary;
}

function getV4AsrOptions(audioLengthSeconds: number): Record<string, unknown> {
    const options: Record<string, unknown> = {
        chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
        stride_length_s: audioLengthSeconds < PRIV_STT.WHISPER_WINDOW_SECONDS ? 0 : PRIV_STT.WHISPER_STRIDE_SECONDS,
        return_timestamps: false,
    };

    if (!PRIV_STT_V4.MODEL_ID.endsWith('.en')) {
        options.language = 'en';
        options.task = 'transcribe';
    }

    return options;
}

export class TransformersJSV4Engine extends STTEngine {
    public readonly type: EngineType = 'transformers-js-v4';
    private transcriber: Pipeline | null = null;
    private worker: Worker | null = null;
    private workerRequestId: number = 0;
    private pendingWorkerRequests = new Map<number, PendingWorkerRequest>();
    private lastModelProgress: number = -1;

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
            logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJSV4] Engine already initialized, skipping.');
            options.onReady?.();
            return Result.ok(undefined);
        }

        logger.info({
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            model: PRIV_STT_V4.MODEL_ID,
            dtype: PRIV_STT_V4.DTYPE,
            device: PRIV_STT_V4.DEVICE ?? 'default-cpu-wasm',
        }, '[TransformersJSV4] Initializing engine...');

        if (isMock) {
            logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJSV4] Mock mode detected - bypassing heavy initialization');
            options.onReady?.();
            return Result.ok(undefined);
        }

        try {
            if (this.shouldUseWorker()) {
                await this.initWorker(isMock);
                options.onModelLoadProgress?.(100);
                this.updateHeartbeat();
                options.onReady?.();
                return Result.ok(undefined);
            }

            const transformers = await import('@huggingface/transformers');
            const { pipeline, env, LogLevel } = transformers;

            env.allowLocalModels = false;
            env.allowRemoteModels = true;

            const isBrowser = typeof window !== 'undefined' &&
                typeof window.document !== 'undefined' &&
                !navigator.userAgent.includes('HappyDOM');

            env.useBrowserCache = isBrowser && !ENV.isE2E;
            env.logLevel = ENV.debug ? LogLevel.INFO : LogLevel.ERROR;

            options.onModelLoadProgress?.(0);

            const progress_callback = (data: unknown) => {
                const progress = typeof data === 'object' && data !== null && 'progress' in data
                    ? Number((data as { progress?: number }).progress)
                    : undefined;
                if (progress !== undefined && Number.isFinite(progress)) {
                    options.onModelLoadProgress?.(progress);
                }
            };

            const loadStart = performance.now();
            const pipelineOptions: Record<string, unknown> = {
                dtype: PRIV_STT_V4.DTYPE,
                progress_callback,
            };
            if (PRIV_STT_V4.DEVICE) {
                pipelineOptions.device = PRIV_STT_V4.DEVICE;
            }

            this.transcriber = await pipeline(
                'automatic-speech-recognition',
                PRIV_STT_V4.MODEL_ID,
                pipelineOptions
            );

            await this.warmUpMainThreadTranscriber();

            const loadTime = performance.now() - loadStart;
            logger.info({
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                event: 'model_loaded',
                model: PRIV_STT_V4.MODEL_ID,
                dtype: PRIV_STT_V4.DTYPE,
                expected_download_mb: PRIV_STT_V4.EXPECTED_Q4_SPLIT_DOWNLOAD_MB,
                load_time_ms: Math.round(loadTime),
                engine: 'transformersjs-v4',
            }, '[TransformersJSV4] Engine initialized successfully.');

            options.onModelLoadProgress?.(100);
            this.updateHeartbeat();
            options.onReady?.();
            return Result.ok(undefined);
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                errorName: e.name,
                errorMessage: e.message,
            }, '[TransformersJSV4] Failed to initialize engine.');
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
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, userWordsCount: userWords.length }, '[TransformersJSV4] Engine started');
    }

    protected async onStop(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJSV4] Stopping engine...');
    }

    public async pause(): Promise<void> {
        await this.onPause();
    }

    protected async onPause(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJSV4] Pausing engine...');
    }

    public async resume(): Promise<void> {
        await this.onResume();
    }

    protected async onResume(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJSV4] Resuming engine...');
    }

    protected async onDestroy(): Promise<void> {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[TransformersJSV4] Destroying engine resources...');
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
                }, '[TransformersJSV4] Worker destroy request failed.');
            }
            this.worker.terminate();
            this.worker = null;
        }
        this.pendingWorkerRequests.forEach(({ reject, timeoutId }) => {
            clearTimeout(timeoutId);
            reject(new Error('TransformersJSV4 worker destroyed.'));
        });
        this.pendingWorkerRequests.clear();
    }

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.transcriber && !this.worker) {
            return { isOk: false, error: new Error('TransformersJSV4 engine not initialized. Call init() first.') };
        }

        this.updateHeartbeat();

        try {
            if (this.worker) {
                const workerAudio = audio.slice(0);
                const response = await this.sendWorkerRequest(
                    { type: 'transcribe', audio: workerAudio },
                    [workerAudio.buffer],
                );
                if (response.type !== 'result') {
                    throw new Error(`Unexpected TransformersJSV4 worker response: ${response.type}`);
                }

                logger.info({
                    sId: this.serviceId,
                    rId: this.runId,
                    eId: this.instanceId,
                    event: 'inference_complete',
                    latency_ms: response.latencyMs,
                    audio_length_s: response.audioLengthSeconds,
                    engine: 'transformersjs-v4-worker',
                    result_shape: response.resultShape,
                }, '[TransformersJSV4] Worker transcription complete.');

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
                            preview: response.transcript.slice(0, 120),
                        },
                    }, '[PRIVATE_DIAG] transformers_v4_worker_result_shape');
                }

                this.currentTranscript = response.transcript;
                this.updateHeartbeat();
                return { isOk: true, data: response.transcript };
            }

            const start = performance.now();
            interface TranscriptionResult {
                text?: string;
                transcript?: string;
            }

            const audioLengthSeconds = samplesToSeconds(audio.length, PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ);
            const options = getV4AsrOptions(audioLengthSeconds);

            const result = await (this.transcriber as (audio: Float32Array, options: Record<string, unknown>) => Promise<string | TranscriptionResult>)(audio, options);

            const latency = performance.now() - start;
            logger.info({
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                event: 'inference_complete',
                latency_ms: Math.round(latency),
                audio_length_s: audioLengthSeconds,
                engine: 'transformersjs-v4',
                result_shape: typeof result === 'string' ? 'string' : Object.keys(result).sort().join(',')
            }, '[TransformersJSV4] Transcription complete.');

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
                }, '[PRIVATE_DIAG] transformers_v4_result_shape');
            }

            this.currentTranscript = transcript;
            this.updateHeartbeat();
            return { isOk: true, data: transcript };
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, err: e }, '[TransformersJSV4] Transcription failed.');
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
        this.worker = new Worker(v4WorkerUrl, { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const response = event.data;
            if (response.type === 'progress') {
                    this.reportModelProgress(response.progress);
                    return;
            }

            if (response.type === 'loaded') {
                logger.info({
                    sId: this.serviceId,
                    rId: this.runId,
                    eId: this.instanceId,
                    event: 'model_loaded',
                    model: response.model,
                    device: response.device,
                    load_time_ms: response.loadTimeMs,
                    engine: 'transformersjs-v4-worker',
                }, '[TransformersJSV4] Worker engine loaded.');
                return;
            }

            if (response.type === 'warmed') {
                logger.info({
                    sId: this.serviceId,
                    rId: this.runId,
                    eId: this.instanceId,
                    warmup_ms: response.warmupMs,
                    engine: 'transformersjs-v4-worker',
                }, '[TransformersJSV4] Worker engine warmed up.');
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
            const error = new Error(event.message || 'TransformersJSV4 worker failed.');
            this.pendingWorkerRequests.forEach(({ reject, timeoutId }) => {
                clearTimeout(timeoutId);
                reject(error);
            });
            this.pendingWorkerRequests.clear();
        };

        const response = await this.sendWorkerRequest({ type: 'init', isE2E: Boolean(isMock) });
        if (response.type !== 'ready') {
            throw new Error(`Unexpected TransformersJSV4 worker init response: ${response.type}`);
        }
    }

    private reportModelProgress(progress: number): void {
        const normalized = Math.max(0, Math.min(100, Math.round(progress)));
        if (normalized !== 100 && normalized - this.lastModelProgress < 1) {
            return;
        }
        if (normalized === this.lastModelProgress) {
            return;
        }

        this.lastModelProgress = normalized;
        (this.options as TranscriptionModeOptions).onModelLoadProgress?.(normalized);
    }

    private sendWorkerRequest(
        request: { type: 'init'; isE2E: boolean } | { type: 'transcribe'; audio: Float32Array } | { type: 'destroy' },
        transfer?: Transferable[],
    ): Promise<WorkerResponse> {
        if (!this.worker) {
            return Promise.reject(new Error('TransformersJSV4 worker is not available.'));
        }

        const id = ++this.workerRequestId;
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (!this.pendingWorkerRequests.has(id)) return;
                this.pendingWorkerRequests.delete(id);
                reject(new Error(`TransformersJSV4 worker request timed out after ${PRIV_STT_V4.WORKER_REQUEST_TIMEOUT_MS}ms (${request.type}).`));
            }, PRIV_STT_V4.WORKER_REQUEST_TIMEOUT_MS);
            this.pendingWorkerRequests.set(id, { resolve, reject, timeoutId });
            this.worker?.postMessage({ id, ...request }, transfer ?? []);
        });
    }

    private async warmUpMainThreadTranscriber(): Promise<void> {
        if (!this.transcriber) return;
        const warmupAudio = new Float32Array(PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ);
        const start = performance.now();
        await (this.transcriber as (audio: Float32Array, options: Record<string, unknown>) => Promise<unknown>)(warmupAudio, {
            chunk_length_s: 0,
            return_timestamps: false,
        });
        logger.info({
            sId: this.serviceId,
            rId: this.runId,
            eId: this.instanceId,
            warmup_ms: Math.round(performance.now() - start),
            engine: 'transformersjs-v4',
        }, '[TransformersJSV4] Main-thread engine warmed up.');
    }
}
