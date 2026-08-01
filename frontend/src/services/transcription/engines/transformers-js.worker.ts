import { PRIV_CLOUD_AUDIO, PRIV_STT, samplesToSeconds } from '../sttConstants';
import { computeWasmThreadCount, getHardwareThreads, isCrossOriginIsolated, MAX_WASM_THREADS } from '../utils/wasmThreads';
import { createProgressAggregator, type ProgressEvent } from './progressAggregator';
import { TRANSFORMERS_V2_WASM_PATHS } from './transformersV2WasmAssets';

type Pipeline = Awaited<ReturnType<typeof import('@xenova/transformers')['pipeline']>>;
type WhisperDecodeOptions = Record<string, unknown>;

type WorkerRequest =
    | { id: number; type: 'init'; isE2E: boolean; model?: { key: string; localId: string; remoteId: string } }
    | { id: number; type: 'transcribe'; audio: Float32Array; decodeOptions?: WhisperDecodeOptions; captureEvidence?: boolean }
    | { id: number; type: 'destroy' };

type WorkerResponse =
    | { id: number; type: 'ready' }
    | { id: number; type: 'progress'; progress: number }
    | {
        id: number;
        type: 'loaded';
        loadTimeMs: number;
        model: string;
        device: string;
        requestedThreads: number;
        configuredThreads: number | null;
        workerReportedThreads: null;
        crossOriginIsolated: boolean;
      }
    | {
        id: number;
        type: 'result';
        transcript: string;
        latencyMs: number;
        audioLengthSeconds: number;
        resultShape: string;
        inputEvidence?: { sha256: string; samples: number; bytes: number };
      }
    | { id: number; type: 'destroyed' }
    | { id: number; type: 'error'; errorName: string; errorMessage: string };

interface TranscriptionResult {
    text?: string;
    transcript?: string;
}

let transcriber: Pipeline | null = null;

const WARMUP_AUDIO_SECONDS = 1;

async function sha256Float32(audio: Float32Array): Promise<string> {
    const bytes = new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function warmUpTranscriber(): Promise<void> {
    if (!transcriber) return;

    const warmupAudio = new Float32Array(PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ * WARMUP_AUDIO_SECONDS);
    const options: Record<string, unknown> = {
        chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
        stride_length_s: 0,
        return_timestamps: false,
    };

    await (transcriber as (audio: Float32Array, options: Record<string, unknown>) => Promise<string | TranscriptionResult>)(warmupAudio, options);
}

function post(response: WorkerResponse): void {
    self.postMessage(response);
}

async function init(id: number, isE2E: boolean, model?: { key: string; localId: string; remoteId: string }): Promise<void> {
    if (transcriber) {
        post({ id, type: 'ready' });
        return;
    }

    if (isE2E) {
        post({ id, type: 'ready' });
        return;
    }

    const transformers = await import('@xenova/transformers');
    const { pipeline, env } = transformers;

    if (!env) {
        throw new Error('TransformersJS environment (env) is undefined. Check import logic.');
    }

    env.allowLocalModels = true;
    env.localModelPath = '/models/';
    env.allowRemoteModels = false;
    env.useBrowserCache = true;

    // PERF (P3): The ONNX WASM backend defaults to a single thread, which is the
    // dominant reason CPU Whisper decodes take tens of seconds and no live text
    // appears while a decode is blocked. Multi-threaded WASM requires the worker
    // to be cross-origin isolated (COOP/COEP). The shared `computeWasmThreadCount`
    // policy degrades to 1 thread (the guaranteed CPU floor) when isolation is
    // unavailable, so this is safe everywhere. Telemetry below reports the actual
    // device/threads so release proof can confirm which CPU tier ran.
    let configuredThreads: number | null = null;
    const cpuIsolated = isCrossOriginIsolated();
    try {
        const wasmBackend = env.backends?.onnx?.wasm;
        if (wasmBackend) {
            wasmBackend.wasmPaths = TRANSFORMERS_V2_WASM_PATHS;
            const desiredThreads = computeWasmThreadCount(cpuIsolated, getHardwareThreads());
            wasmBackend.numThreads = desiredThreads;
            wasmBackend.simd = true;
            configuredThreads = desiredThreads;
        }
    } catch {
        // Non-fatal: the library may continue with its defaults, but those
        // defaults are not observable here. Never relabel an unknown runtime
        // configuration as explicit single-thread evidence.
        configuredThreads = null;
    }

    // MAXDEPTH FIX (Part 4): whisper-base.en is a SPLIT model (separate encoder +
    // decoder ONNX files). transformers.js fires progress_callback PER FILE, each
    // ramping 0→100 independently, so forwarding the raw per-file `progress` yields a
    // non-monotonic, oscillating stream that drives a React render loop ("Maximum
    // update depth exceeded"). Aggregate to one monotonic overall percent at the
    // source — see createProgressAggregator for the full rationale + the trace.
    const aggregateProgress = createProgressAggregator();
    const progress_callback = (data: ProgressEvent) => {
        const overall = aggregateProgress(data);
        if (overall !== null) {
            post({ id, type: 'progress', progress: overall });
        }
    };

    const loadStart = performance.now();
    // Model-eval flag: default keeps whisper-tiny.en (production); a flag-selected model is
    // passed from the main thread in the init request. RMS/decode path is otherwise unchanged.
    const localModelId = model?.localId ?? 'whisper-tiny.en';
    const loadedModelKey = model?.key ?? 'whisper-tiny.en';
    // SELF-HOSTED, NO HUGGINGFACE AT RUNTIME: every Private model (whisper-tiny.en, whisper-base.en)
    // is bundled under /models/ and served from our own origin (Vercel, via Git LFS). We load
    // LOCAL-ONLY and fail closed — `allowRemoteModels` stays false so a missing/misnamed asset
    // surfaces a clear MODEL_LOAD_FAILED instead of silently reaching out to huggingface.co.
    // (env.allowLocalModels/localModelPath='/models/' are set to the local floor above.)
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    try {
        transcriber = await pipeline('automatic-speech-recognition', localModelId, {
            quantized: true,
            progress_callback,
        });
    } catch (loadError) {
        // Fail-fast with a NAMED, attributable error so the harness/mic isn't left hanging.
        // The worker's onmessage handler catches this and posts a single type:'error'.
        const detail = loadError instanceof Error ? loadError.message : String(loadError);
        throw new Error(`MODEL_LOAD_FAILED [${loadedModelKey} local /models/${localModelId}]: ${detail}`);
    }

    post({
        id,
        type: 'loaded',
        loadTimeMs: Math.round(performance.now() - loadStart),
        model: loadedModelKey,
        device: configuredThreads == null
            ? 'wasm-default-unverified'
            : configuredThreads > 1 ? 'wasm-multithread' : 'wasm-singlethread',
        requestedThreads: MAX_WASM_THREADS,
        configuredThreads,
        // ORT v1.14 accepts numThreads configuration but does not expose an
        // independent effective-thread count. Never relabel configuration as proof.
        workerReportedThreads: null,
        crossOriginIsolated: cpuIsolated,
    });
    await warmUpTranscriber();
    post({ id, type: 'ready' });
}

async function transcribe(
    id: number,
    audio: Float32Array,
    decodeOptions?: WhisperDecodeOptions,
    captureEvidence = false,
): Promise<void> {
    if (!transcriber) {
        throw new Error('TransformersJS worker engine not initialized. Call init() first.');
    }

    const start = performance.now();
    const audioLengthSeconds = samplesToSeconds(audio.length, PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ);
    const options: Record<string, unknown> = {
        chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
        stride_length_s: audioLengthSeconds < PRIV_STT.WHISPER_WINDOW_SECONDS ? 0 : PRIV_STT.WHISPER_STRIDE_SECONDS,
        return_timestamps: true,
    };
    Object.assign(options, decodeOptions);

    // Hash only when the dedicated evidence harness explicitly opts in. Ordinary
    // Private sessions avoid the full-buffer copy and digest cost entirely.
    const inputEvidence = captureEvidence ? {
        sha256: await sha256Float32(audio),
        samples: audio.length,
        bytes: audio.byteLength,
    } : undefined;
    const result = await (transcriber as (audio: Float32Array, options: Record<string, unknown>) => Promise<string | TranscriptionResult>)(audio, options);
    const transcript = typeof result === 'string'
        ? result
        : result.text ?? result.transcript ?? '';

    post({
        id,
        type: 'result',
        transcript,
        latencyMs: Math.round(performance.now() - start),
        audioLengthSeconds,
        resultShape: typeof result === 'string' ? 'string' : Object.keys(result).sort().join(','),
        ...(inputEvidence ? { inputEvidence } : {}),
    });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;
    void (async () => {
        try {
            switch (request.type) {
                case 'init':
                    await init(request.id, request.isE2E, request.model);
                    break;
                case 'transcribe':
                    await transcribe(request.id, request.audio, request.decodeOptions, request.captureEvidence);
                    break;
                case 'destroy':
                    transcriber = null;
                    post({ id: request.id, type: 'destroyed' });
                    break;
            }
        } catch (error) {
            const e = error instanceof Error ? error : new Error(String(error));
            post({
                id: request.id,
                type: 'error',
                errorName: e.name,
                errorMessage: e.message,
            });
        }
    })();
};
