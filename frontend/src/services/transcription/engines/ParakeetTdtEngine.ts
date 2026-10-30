import type { IPrivateSTTEngine, PrivateRuntimeEvidence } from '@/contracts/IPrivateSTTEngine';
import logger from '@/lib/logger';
import type { Result, TranscriptionModeOptions } from '../modes/types';
import type { MicStream } from '../utils/types';
import type { AvailabilityResult } from '../STTStrategy';
import { fetchVerifiedAssets } from '../moonshineAssetPins';
import { assertParakeetProfile, requiredParakeetFiles, type ParakeetTdtOptions,
    type ParakeetWorkerReply } from './parakeet/contracts';

/** Strict TDT adapter; the existing facade owns capture, consent, transcript accumulation and saves. */
export class ParakeetTdtEngine implements IPrivateSTTEngine {
    readonly type = 'parakeet-tdt' as const;
    readonly liveResultKind = 'incremental' as const;
    private worker: Worker | null = null;
    private generation = 0;
    private nextId = 0;
    private abort: AbortController | null = null;
    private runtimeUrl: string | null = null;
    private evidence: PrivateRuntimeEvidence | null = null;
    private heartbeat = 0;
    private readonly options: ParakeetTdtOptions;
    private readonly pending = new Map<number, { resolve: (reply: ParakeetWorkerReply) => void;
        reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

    constructor(options: ParakeetTdtOptions) {
        this.options = Object.freeze({ ...options, profile: Object.freeze({ ...options.profile }),
            runtime: Object.freeze({ ...options.runtime }),
            assets: Object.freeze(options.assets.map(asset => Object.freeze({ ...asset }))),
        });
    }

    getRuntimeEvidence(): PrivateRuntimeEvidence | null { return this.evidence ? { ...this.evidence } : null; }
    getLastHeartbeatTimestamp(): number { return this.heartbeat; }

    async checkAvailability(): Promise<AvailabilityResult> {
        try {
            assertParakeetProfile(this.options.profile, this.options.runtime);
            const names = this.options.assets.map(asset => asset.file);
            const required = requiredParakeetFiles(this.options.profile);
            if (new Set(names).size !== names.length || names.length !== required.length ||
                required.some(name => !names.includes(name))) {
                throw new Error('Parakeet verified runtime binding/glue/WASM inventory is incomplete');
            }
            if (typeof Worker === 'undefined') throw new Error('Parakeet requires a dedicated worker');
            return { isAvailable: true };
        } catch (error) {
            logger.warn('[ParakeetTDT] Adapter prerequisite unavailable');
            return { isAvailable: false, reason: 'UNSUPPORTED',
                message: error instanceof Error ? error.message : String(error) };
        }
    }

    private request(payload: Record<string, unknown>, timeoutMs: number,
        transfer: Transferable[] = []): Promise<ParakeetWorkerReply> {
        const worker = this.worker;
        if (!worker) return Promise.reject(new Error('Parakeet worker unavailable'));
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Parakeet worker timed out'));
                if (this.worker === worker) void this.terminate();
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try { worker.postMessage({ ...payload, id }, transfer); }
            catch (error) {
                logger.warn('[ParakeetTDT] Worker request could not be posted');
                clearTimeout(timer); this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    async init(timeoutMs = 120_000, isMock = false): Promise<Result<void, Error>> {
        const retirement = this.terminate();
        const generation = this.generation;
        await retirement;
        if (generation !== this.generation) return { isOk: false, error: new Error('Parakeet initialization superseded') };
        const abort = new AbortController();
        this.abort = abort;
        const deadline = Date.now() + timeoutMs;
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        try {
            if (isMock) throw new Error('Parakeet production adapter refuses mock initialization');
            const available = await this.checkAvailability();
            if (!available.isAvailable) throw new Error(available.message);
            const total = this.options.assets.reduce((sum, asset) => sum + asset.bytes, 0);
            let loaded = 0;
            const files = await fetchVerifiedAssets([...this.options.assets],
                (input, init) => fetch(input, { ...init, signal: abort.signal }), (_file, bytes) => {
                    loaded += bytes;
                    if (generation === this.generation) this.options.onDownloadProgress?.(loaded / total);
                });
            if (generation !== this.generation || abort.signal.aborted) throw new Error('Parakeet initialization cancelled');
            this.runtimeUrl = URL.createObjectURL(new Blob([files[this.options.profile.runtimeBundleFile] as BlobPart],
                { type: 'text/javascript' }));
            const worker = new Worker(new URL('./parakeet/parakeet.worker.ts', import.meta.url), { type: 'module' });
            this.worker = worker;
            worker.onmessage = ({ data }: MessageEvent<ParakeetWorkerReply>) => {
                if (this.worker !== worker || generation !== this.generation) return;
                const item = this.pending.get(data.id);
                if (!item) return;
                clearTimeout(item.timer); this.pending.delete(data.id); this.heartbeat = Date.now();
                if (data.ok) item.resolve(data); else item.reject(new Error(data.error));
            };
            worker.onerror = () => { if (this.worker === worker) void this.terminate(); };
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error('Parakeet initialization timed out');
            const buffers = [...new Set(Object.values(files).map(file => file.buffer))];
            if (buffers.some(buffer => !(buffer instanceof ArrayBuffer))) throw new Error('Parakeet requires owned asset buffers');
            const reply = await this.request({ type: 'init', files, runtimeUrl: this.runtimeUrl,
                profile: this.options.profile, runtime: this.options.runtime }, remaining, buffers as ArrayBuffer[]);
            if (generation !== this.generation) throw new Error('Parakeet initialization superseded');
            if (!reply.ok || reply.type !== 'ready' || reply.backend !== 'wasm' ||
                reply.ortVersion !== this.options.runtime.ortVersion) throw new Error('Parakeet runtime identity mismatch');
            // Successful strict WASM warmup, not introspection of model weights.
            this.evidence = { initSucceeded: true, backend: 'wasm', modelId: null, fallbackOccurred: false };
            return { isOk: true, data: undefined };
        } catch (error) {
            logger.warn('[ParakeetTDT] Initialization failed or was superseded');
            if (generation === this.generation) await this.terminate();
            return { isOk: false, error: error instanceof Error ? error : new Error(String(error)) };
        } finally { clearTimeout(timer); }
    }

    async start(mic?: MicStream): Promise<void> {
        if (!this.evidence) throw new Error('Parakeet start before initialization');
        if (mic && mic.sampleRate !== 16000) throw new Error('Parakeet requires 16 kHz mono capture');
    }
    async stop(): Promise<void> {}
    async pause(): Promise<void> {}
    async resume(): Promise<void> {}
    updateOptions(_options: Partial<TranscriptionModeOptions>): void {} // Recording identity stays frozen.

    async transcribe(audio: Float32Array): Promise<Result<string, Error>> {
        const generation = this.generation;
        try {
            if (!this.evidence) throw new Error('Parakeet decode before initialization');
            if (!audio.length || audio.some(sample => !Number.isFinite(sample))) throw new Error('Parakeet requires finite PCM');
            const copy = audio.slice();
            const reply = await this.request({ type: 'decode', audio: copy }, 120_000, [copy.buffer]);
            if (generation !== this.generation) throw new Error('Parakeet decode superseded');
            if (!reply.ok || reply.type !== 'transcript' || typeof reply.text !== 'string') {
                throw new Error('Parakeet returned no transcript');
            }
            return { isOk: true, data: reply.text };
        } catch (error) {
            logger.warn('[ParakeetTDT] Decode failed or was superseded');
            if (generation === this.generation) await this.terminate();
            return { isOk: false, error: error instanceof Error ? error : new Error(String(error)) };
        }
    }

    async destroy(): Promise<void> { await this.terminate(); }
    async terminate(): Promise<void> {
        this.generation++;
        this.abort?.abort(); this.abort = null;
        this.evidence = null;
        this.worker?.terminate(); this.worker = null;
        if (this.runtimeUrl) URL.revokeObjectURL(this.runtimeUrl);
        this.runtimeUrl = null;
        for (const item of this.pending.values()) {
            clearTimeout(item.timer); item.reject(new Error('Parakeet engine terminated'));
        }
        this.pending.clear();
    }
}
