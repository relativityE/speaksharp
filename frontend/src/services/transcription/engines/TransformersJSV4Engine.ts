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

type Pipeline = Awaited<ReturnType<typeof import('@huggingface/transformers')['pipeline']>>;
type UnknownRecord = Record<string, unknown>;

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

export class TransformersJSV4Engine extends STTEngine {
    public readonly type: EngineType = 'transformers-js-v4';
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

            const loadTime = performance.now() - loadStart;
            logger.info({
                sId: this.serviceId,
                rId: this.runId,
                eId: this.instanceId,
                event: 'model_loaded',
                model: PRIV_STT_V4.MODEL_ID,
                dtype: PRIV_STT_V4.DTYPE,
                expected_download_mb: PRIV_STT_V4.EXPECTED_Q8_DOWNLOAD_MB,
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
    }

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        if (!this.transcriber) {
            return { isOk: false, error: new Error('TransformersJSV4 engine not initialized. Call init() first.') };
        }

        this.updateHeartbeat();

        try {
            const start = performance.now();
            interface TranscriptionResult {
                text?: string;
                transcript?: string;
            }

            const audioLengthSeconds = samplesToSeconds(audio.length, PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ);
            const options: Record<string, unknown> = {
                chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
                stride_length_s: audioLengthSeconds < PRIV_STT.WHISPER_WINDOW_SECONDS ? 0 : PRIV_STT.WHISPER_STRIDE_SECONDS,
                return_timestamps: false,
            };

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
}
