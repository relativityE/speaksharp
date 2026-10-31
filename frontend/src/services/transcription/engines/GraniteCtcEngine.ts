import type { IPrivateSTTEngine, PrivateRuntimeEvidence } from '@/contracts/IPrivateSTTEngine';
import type { Result, TranscriptionModeOptions } from '../modes/types';
import type { MicStream } from '../utils/types';
import { fetchVerifiedAssets, type PinnedAsset } from '../moonshineAssetPins';
import coreUrl from './granite/ctc-core.js?url';
import workerSource from './granite/granite.worker.js?raw';

export interface GraniteEngineOptions {
    modelFile: string;
    backend: 'webgpu' | 'wasm';
    applyAgc: boolean;
    assets: readonly PinnedAsset[];
    onDownloadProgress?: (fraction: number) => void;
}

type Reply = { id: number; ok: boolean; backend?: string; text?: string; error?: string };

/** Shared facade adapter; no streaming microphone or alternate transcript owner. */
export class GraniteCtcEngine implements IPrivateSTTEngine {
    readonly type = 'granite-ctc' as const;
    readonly liveResultKind = 'incremental' as const;
    private worker: Worker | null = null;
    private generation = 0;
    private nextId = 0;
    private abort: AbortController | null = null;
    private runtimeUrl: string | null = null;
    private workerSourceUrl: string | null = null;
    private evidence: PrivateRuntimeEvidence | null = null;
    private heartbeat = 0;
    private pending = new Map<number, { resolve: (reply: Reply) => void; reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout> }>();

    private readonly options: GraniteEngineOptions;
    constructor(options: GraniteEngineOptions) {
        this.options = Object.freeze({ ...options,
            assets: Object.freeze(options.assets.map(asset => Object.freeze({ ...asset }))),
        });
    }

    getRuntimeEvidence(): PrivateRuntimeEvidence | null { return this.evidence ? { ...this.evidence } : null; }
    getLastHeartbeatTimestamp(): number { return this.heartbeat; }
    async checkAvailability() {
        return { isAvailable: typeof Worker !== 'undefined' &&
            (this.options.backend === 'wasm' || (typeof navigator !== 'undefined' && 'gpu' in navigator)),
        };
    }

    private request(payload: Record<string, unknown>, timeoutMs: number, transfer: Transferable[] = []): Promise<Reply> {
        const worker = this.worker;
        if (!worker) return Promise.reject(new Error('Granite worker unavailable'));
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Granite worker timed out'));
                // A timed-out inference must not continue consuming memory behind a new take.
                if (this.worker === worker) void this.terminate();
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try { worker.postMessage({ ...payload, id }, transfer); }
            catch (error) {
                clearTimeout(timer); this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    async init(timeoutMs = 120_000, isMock = false): Promise<Result<void, Error>> {
        const retirement = this.terminate();
        const generation = this.generation;
        await retirement;
        if (generation !== this.generation) return { isOk: false, error: new Error('Granite initialization superseded') };
        const abort = new AbortController();
        this.abort = abort;
        const deadline = Date.now() + timeoutMs;
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        try {
            if (generation !== this.generation) throw new Error('Granite initialization superseded');
            if (isMock) throw new Error('Granite production adapter refuses mock initialization');
            if (!(await this.checkAvailability()).isAvailable) throw new Error('Granite backend unavailable');
            const names = this.options.assets.map(asset => asset.file);
            if (new Set(names).size !== names.length) throw new Error('Duplicate Granite asset names');
            let loaded = 0;
            const total = this.options.assets.reduce((sum, asset) => sum + asset.bytes, 0);
            const files = await fetchVerifiedAssets([...this.options.assets],
                (input, init) => fetch(input, { ...init, signal: abort.signal }), (_file, bytes) => {
                    loaded += bytes;
                    if (generation === this.generation) this.options.onDownloadProgress?.(loaded / total);
                });
            if (generation !== this.generation || abort.signal.aborted) throw new Error('Granite initialization cancelled');
            for (const required of ['ort.all.min.js', 'ort-wasm-simd-threaded.jsep.mjs',
                'ort-wasm-simd-threaded.jsep.wasm']) {
                if (!files[required]) throw new Error(`Missing pinned runtime asset ${required}`);
            }
            this.runtimeUrl = URL.createObjectURL(new Blob([files['ort.all.min.js'] as BlobPart], { type: 'text/javascript' }));
            // Vite's application workers are ES modules; ORT's UMD runtime needs a classic worker.
            this.workerSourceUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
            const worker = new Worker(this.workerSourceUrl);
            this.worker = worker;
            worker.onmessage = ({ data }: MessageEvent<Reply>) => {
                if (this.worker !== worker || generation !== this.generation) return;
                const item = this.pending.get(data.id);
                if (!item) return;
                clearTimeout(item.timer); this.pending.delete(data.id);
                this.heartbeat = Date.now();
                if (data.ok) item.resolve(data); else item.reject(new Error(data.error ?? 'Granite operation failed'));
            };
            worker.onerror = () => { if (this.worker === worker) void this.terminate(); };
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error('Granite initialization timed out');
            const reply = await this.request({ type: 'init', runtimeUrl: this.runtimeUrl,
                coreModuleUrl: new URL(coreUrl, window.location.href).href, files,
                modelFile: this.options.modelFile, backend: this.options.backend }, remaining);
            if (generation !== this.generation) throw new Error('Granite initialization superseded');
            if (reply.backend !== this.options.backend) throw new Error('Granite backend identity mismatch');
            // Reports the single requested EP accepted by session creation/warmup, not per-op
            // backend introspection. Asset provenance is verified separately before worker startup.
            this.evidence = { initSucceeded: true, backend: reply.backend, modelId: null, fallbackOccurred: false };
            return { isOk: true, data: undefined };
        } catch (error) {
            if (generation === this.generation) await this.terminate();
            return { isOk: false, error: error instanceof Error ? error : new Error(String(error)) };
        } finally { clearTimeout(timer); }
    }

    async start(mic?: MicStream): Promise<void> {
        if (!this.evidence) throw new Error('Granite start before initialization');
        if (mic && mic.sampleRate !== 16000) throw new Error('Granite requires 16 kHz mono capture');
    }
    async stop(): Promise<void> {}
    async pause(): Promise<void> {}
    async resume(): Promise<void> {}
    updateOptions(_options: Partial<TranscriptionModeOptions>): void {} // Identity is frozen at construction.

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        try {
            if (!this.evidence) throw new Error('Granite decode before initialization');
            const copy = audio.slice();
            const result = await this.request({ type: 'decode', audio: copy, applyAgc: this.options.applyAgc },
                120_000, [copy.buffer]);
            if (typeof result.text !== 'string') throw new Error('Granite returned no transcript');
            return { isOk: true, data: result.text };
        } catch (error) {
            return { isOk: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    }

    async destroy(): Promise<void> {
        const generation = this.generation;
        try { if (this.worker) await this.request({ type: 'dispose' }, 2000); }
        finally { if (generation === this.generation) await this.terminate(); }
    }
    async terminate(): Promise<void> {
        this.generation++;
        this.abort?.abort(); this.abort = null;
        this.evidence = null;
        this.worker?.terminate(); this.worker = null;
        if (this.runtimeUrl) URL.revokeObjectURL(this.runtimeUrl);
        this.runtimeUrl = null;
        if (this.workerSourceUrl) URL.revokeObjectURL(this.workerSourceUrl);
        this.workerSourceUrl = null;
        for (const item of this.pending.values()) {
            clearTimeout(item.timer); item.reject(new Error('Granite engine terminated'));
        }
        this.pending.clear();
    }
}
