import { PRIV_CLOUD_AUDIO, PRIV_STT, samplesToSeconds } from '../sttConstants';
import { buildShippingDecodeOptions } from '../decodeOptions';
import { computeWasmThreadCount, getHardwareThreads, isCrossOriginIsolated } from '../utils/wasmThreads';
import { createProgressAggregator, type ProgressEvent } from './progressAggregator';
import { TRANSFORMERS_V2_WASM_PATH_PREFIX } from './transformersV2WasmAssets';

type Pipeline = Awaited<ReturnType<typeof import('@xenova/transformers')['pipeline']>>;
import { observeAcquisitionNetwork } from '../acquisitionNetworkObservation';
import type { AcquisitionReceipt } from '../acquisitionAttempt';
type WhisperDecodeOptions = Record<string, unknown>;

type WorkerRequest =
    | {
        id: number; type: 'init'; isE2E: boolean;
        model?: { key: string; localId: string; remoteId: string };
        /** #1259: URL prefixes identifying this candidate's assets, so the receipt below counts model
         *  fetches and not whatever else the worker might request. */
        assetPrefixes?: string[];
        /** #1259: the attempt this load belongs to. Echoed back so a superseded receipt is detectable. */
        attempt?: { token: string; candidateId: string };
      }
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
        requestedThreads: number | null;
        configuredThreads: number | null;
        workerReportedThreads: null;
        crossOriginIsolated: boolean;
        /**
         * #1259 — THE ACQUISITION RECEIPT, MEASURED WHERE THE BYTES ACTUALLY ARRIVE.
         *
         * The model is fetched HERE, inside the worker, so these requests are recorded on the WORKER's
         * performance timeline. `window.performance` on the main thread cannot see them at all: an
         * observer there finds zero matching entries and honestly reports null bytes, null duration and
         * unknown network use for every real v2 and v4 load — which is no measurement at all.
         *
         * Content-free by construction: counts, bytes, milliseconds and booleans. No URL, no asset name,
         * no path. A pinned asset URL can identify a build, so none crosses this boundary.
         */
        acquisition: AcquisitionReceipt | null;
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

async function init(
    id: number, isE2E: boolean,
    model?: { key: string; localId: string; remoteId: string },
    // #1259: supplied by the main thread, which knows the selected candidate. Empty means the receipt
    // reports itself unobservable rather than counting whatever happened to be fetched.
    assetPrefixes: string[] = [],
    attempt?: { token: string; candidateId: string },
): Promise<void> {
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
    let requestedThreads: number | null = null;
    let configuredThreads: number | null = null;
    const cpuIsolated = isCrossOriginIsolated();
    try {
        const wasmBackend = env.backends?.onnx?.wasm;
        if (wasmBackend) {
            wasmBackend.wasmPaths = TRANSFORMERS_V2_WASM_PATH_PREFIX;
            const desiredThreads = computeWasmThreadCount(cpuIsolated, getHardwareThreads());
            requestedThreads = desiredThreads;
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

    // Read the WORKER's own Resource Timing for the window this load occupied. `self.performance` is
    // the worker timeline; it is the only place these fetches appear — measured, not assumed: see
    // tests/e2e/worker-acquisition-timeline.e2e.spec.ts, where the window records zero.
    //
    // Taken AFTER the load has fully settled, deliberately. A resource entry is recorded when the
    // response BODY completes, not when its headers arrive, so a reading taken mid-load would find
    // fewer entries than were actually fetched and under-report the transfer.
    let acquisition: AcquisitionReceipt | null = null;
    try {
        // NO RECEIPT WITHOUT AN IDENTITY. An observation that cannot say which attempt it describes is
        // indistinguishable from a stale one, and the consumer would have to guess.
        acquisition = attempt
            ? {
                ...observeAcquisitionNetwork(assetPrefixes, loadStart, self.performance),
                attemptToken: attempt.token,
                candidateId: attempt.candidateId,
            }
            : null;
    } catch {
        // A receipt we could not take is ABSENT, never a zero. Telemetry must not fail a model load.
        acquisition = null;
    }

    post({
        id,
        type: 'loaded',
        loadTimeMs: Math.round(performance.now() - loadStart),
        acquisition,
        model: loadedModelKey,
        device: configuredThreads == null
            ? 'wasm-default-unverified'
            : configuredThreads > 1 ? 'wasm-multithread' : 'wasm-singlethread',
        requestedThreads,
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
    // #1304: window/stride/timestamps come from the SHARED builder so the v2 product path, the v4
    // engine and the A1 harness cannot drift apart. Do not re-derive these here.
    const options: Record<string, unknown> = { ...buildShippingDecodeOptions(audioLengthSeconds) };
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
                    await init(request.id, request.isE2E, request.model, request.assetPrefixes ?? [], request.attempt);
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
