import { PRIV_CLOUD_AUDIO, PRIV_STT, PRIV_STT_V4, samplesToSeconds } from '../sttConstants';
import { detectWebGPUSupport } from '../utils/webgpuSupport';
import { V4_ANTI_LOOP_DECODE_DEFAULTS } from './whisperDecodeOptions';

type Pipeline = Awaited<ReturnType<typeof import('@huggingface/transformers')['pipeline']>>;

type WorkerRequest =
    | { id: number; type: 'init'; isE2E: boolean; model?: string; dtype?: unknown; device?: string }
    | { id: number; type: 'transcribe'; audio: Float32Array; decodeOptions?: Record<string, unknown> }
    | { id: number; type: 'destroy' };

type WorkerResponse =
    | { id: number; type: 'ready' }
    | { id: number; type: 'progress'; progress: number }
    | { id: number; type: 'loaded'; loadTimeMs: number; model: string; device: string }
    | { id: number; type: 'warmed'; warmupMs: number }
    | { id: number; type: 'result'; transcript: string; latencyMs: number; audioLengthSeconds: number; resultShape: string }
    | { id: number; type: 'destroyed' }
    | { id: number; type: 'error'; errorName: string; errorMessage: string };

interface TranscriptionResult {
    text?: string;
    transcript?: string;
}

let transcriber: Pipeline | null = null;
// The model id actually loaded by init() — drives the ASR language decision (set below).
let loadedModelId: string | null = null;

function post(response: WorkerResponse): void {
    self.postMessage(response);
}

async function getPreferredDevice(): Promise<string | undefined> {
    if (PRIV_STT_V4.DEVICE) {
        return PRIV_STT_V4.DEVICE;
    }

    // WebGPU only when a REAL adapter is acquired. `'gpu' in navigator` is mere
    // presence, not capability: adapter-less / headless Chrome exposes navigator.gpu
    // but requestAdapter() returns null, and choosing 'webgpu' there leaves the
    // pipeline unable to initialize — which (with the model download + init timeout)
    // strands the engine with Start disabled and NO CPU fallback. Validate the
    // adapter; otherwise fall straight to CPU/wasm so the engine always becomes ready.
    return (await detectWebGPUSupport()).supported ? 'webgpu' : undefined;
}

function getAsrOptions(audioLengthSeconds: number, decodeOptions?: Record<string, unknown>): Record<string, unknown> {
    const options: Record<string, unknown> = {
        chunk_length_s: PRIV_STT.WHISPER_WINDOW_SECONDS,
        stride_length_s: audioLengthSeconds < PRIV_STT.WHISPER_WINDOW_SECONDS ? 0 : PRIV_STT.WHISPER_STRIDE_SECONDS,
        return_timestamps: true,
        // Conservative anti-loop generation defaults (F2). Overridable by the proof hook below.
        ...V4_ANTI_LOOP_DECODE_DEFAULTS,
    };

    // Decide language off the model ACTUALLY loaded (base_q4→whisper-base.en, distil_q4→distil-small.en),
    // not the legacy PRIV_STT_V4.MODEL_ID constant. `.en` models are English-only and must NOT set language.
    if (loadedModelId != null && !loadedModelId.endsWith('.en')) {
        options.language = 'en';
        options.task = 'transcribe';
    }

    // Proof-hook overrides (allow-listed on the main thread) win over defaults. Inert unless the
    // browser proof sets window.__PRIVATE_STT_DECODE_OPTIONS__ — product defaults are unchanged.
    if (decodeOptions) {
        Object.assign(options, decodeOptions);
    }

    return options;
}

async function createPipeline(progress_callback: (data: unknown) => void, modelId: string, dtype: unknown, deviceOverride?: string): Promise<{ pipe: Pipeline; device: string }> {
    const transformers = await import('@huggingface/transformers');
    const { pipeline, env, LogLevel } = transformers;

    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    env.logLevel = LogLevel.ERROR;

    // DEV/TEST device override (root-cause A/B): 'wasm' forces CPU/WASM, 'webgpu' forces GPU.
    const preferredDevice = deviceOverride === 'wasm'
        ? undefined
        : deviceOverride === 'webgpu'
            ? 'webgpu'
            : await getPreferredDevice();
    const options: Record<string, unknown> = {
        dtype,
        progress_callback,
    };
    if (preferredDevice) {
        options.device = preferredDevice;
    }

    try {
        return {
            pipe: await pipeline('automatic-speech-recognition', modelId, options),
            device: preferredDevice ?? 'wasm-default',
        };
    } catch (error) {
        if (!preferredDevice) {
            throw error;
        }

        const fallbackOptions = { ...options };
        delete fallbackOptions.device;
        return {
            pipe: await pipeline('automatic-speech-recognition', modelId, fallbackOptions),
            device: 'wasm-fallback',
        };
    }
}

async function warmUp(id: number): Promise<void> {
    if (!transcriber) {
        throw new Error('TransformersJSV4 worker engine not initialized. Call init() first.');
    }

    const warmupAudio = new Float32Array(PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ);
    const start = performance.now();
    await (transcriber as (audio: Float32Array, options: Record<string, unknown>) => Promise<unknown>)(warmupAudio, {
        chunk_length_s: 0,
        return_timestamps: false,
    });
    post({ id, type: 'warmed', warmupMs: Math.round(performance.now() - start) });
}

async function init(id: number, isE2E: boolean, modelId: string, dtype: unknown, deviceOverride?: string): Promise<void> {
    if (transcriber) {
        post({ id, type: 'ready' });
        return;
    }

    if (isE2E) {
        post({ id, type: 'ready' });
        return;
    }

    const progress_callback = (data: unknown) => {
        const progress = typeof data === 'object' && data !== null && 'progress' in data
            ? Number((data as { progress?: number }).progress)
            : undefined;
        if (progress !== undefined && Number.isFinite(progress)) {
            post({ id, type: 'progress', progress });
        }
    };

    const loadStart = performance.now();
    const loaded = await createPipeline(progress_callback, modelId, dtype, deviceOverride);
    transcriber = loaded.pipe;
    loadedModelId = modelId;
    post({
        id,
        type: 'loaded',
        loadTimeMs: Math.round(performance.now() - loadStart),
        model: modelId,
        device: loaded.device,
    });
    try {
        await warmUp(id);
    } catch {
        // Warm-up is an optimization, not a readiness gate. If the model loaded
        // successfully, let the engine start and surface any real decode errors
        // during transcription instead of stranding Private v4 in init-failed.
    }
    post({ id, type: 'ready' });
}

async function transcribe(id: number, audio: Float32Array, decodeOptions?: Record<string, unknown>): Promise<void> {
    if (!transcriber) {
        throw new Error('TransformersJSV4 worker engine not initialized. Call init() first.');
    }

    const start = performance.now();
    const audioLengthSeconds = samplesToSeconds(audio.length, PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ);
    const result = await (transcriber as (audio: Float32Array, options: Record<string, unknown>) => Promise<string | TranscriptionResult>)(
        audio,
        getAsrOptions(audioLengthSeconds, decodeOptions),
    );
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
    });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;
    void (async () => {
        try {
            switch (request.type) {
                case 'init':
                    await init(request.id, request.isE2E, request.model ?? PRIV_STT_V4.MODEL_ID, request.dtype ?? PRIV_STT_V4.DTYPE, request.device);
                    break;
                case 'transcribe':
                    await transcribe(request.id, request.audio, request.decodeOptions);
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
