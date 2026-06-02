import { PRIV_CLOUD_AUDIO, PRIV_STT, samplesToSeconds } from '../sttConstants';
import { computeWasmThreadCount, getHardwareThreads, isCrossOriginIsolated } from '../utils/wasmThreads';

type Pipeline = Awaited<ReturnType<typeof import('@xenova/transformers')['pipeline']>>;

type WorkerRequest =
    | { id: number; type: 'init'; isE2E: boolean }
    | { id: number; type: 'transcribe'; audio: Float32Array }
    | { id: number; type: 'destroy' };

type WorkerResponse =
    | { id: number; type: 'ready' }
    | { id: number; type: 'progress'; progress: number }
    | { id: number; type: 'loaded'; loadTimeMs: number; model: string; device: string; threads: number; crossOriginIsolated: boolean }
    | { id: number; type: 'result'; transcript: string; latencyMs: number; audioLengthSeconds: number; resultShape: string }
    | { id: number; type: 'destroyed' }
    | { id: number; type: 'error'; errorName: string; errorMessage: string };

interface TranscriptionResult {
    text?: string;
    transcript?: string;
}

let transcriber: Pipeline | null = null;

const WARMUP_AUDIO_SECONDS = 1;

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

async function init(id: number, isE2E: boolean): Promise<void> {
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
    let cpuThreads = 1;
    const cpuIsolated = isCrossOriginIsolated();
    try {
        const wasmBackend = env.backends?.onnx?.wasm;
        if (wasmBackend) {
            cpuThreads = computeWasmThreadCount(cpuIsolated, getHardwareThreads());
            wasmBackend.numThreads = cpuThreads;
            wasmBackend.simd = true;
        }
    } catch {
        // Non-fatal: fall back to library defaults (single-threaded).
        cpuThreads = 1;
    }

    const progress_callback = (data: { progress?: number }) => {
        if (data.progress !== undefined) {
            post({ id, type: 'progress', progress: data.progress });
        }
    };

    const loadStart = performance.now();
    try {
        transcriber = await pipeline(
            'automatic-speech-recognition',
            'whisper-tiny.en',
            {
                quantized: true,
                progress_callback,
            },
        );
    } catch (localError) {
        env.allowRemoteModels = true;
        transcriber = await pipeline(
            'automatic-speech-recognition',
            'Xenova/whisper-tiny.en',
            {
                quantized: true,
                revision: 'main',
                progress_callback,
            },
        );
    }

    post({
        id,
        type: 'loaded',
        loadTimeMs: Math.round(performance.now() - loadStart),
        model: 'whisper-tiny.en',
        device: cpuThreads > 1 ? 'wasm-multithread' : 'wasm-singlethread',
        threads: cpuThreads,
        crossOriginIsolated: cpuIsolated,
    });
    await warmUpTranscriber();
    post({ id, type: 'ready' });
}

async function transcribe(id: number, audio: Float32Array): Promise<void> {
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
    });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;
    void (async () => {
        try {
            switch (request.type) {
                case 'init':
                    await init(request.id, request.isE2E);
                    break;
                case 'transcribe':
                    await transcribe(request.id, request.audio);
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
