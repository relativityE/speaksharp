import type { MicStream } from '../utils/types';
import type { Result } from '../modes/types';
import type { AvailabilityResult, STTStrategy } from '../STTStrategy';

/**
 * #1263 — Moonshine Streaming as a PRODUCT engine.
 *
 * The benchmark already runs Moonshine, but a benchmark arm is not a product engine: it decodes an
 * isolated clip in a page the harness controls, with no microphone, no lifecycle, no failure surface and
 * no metadata. Being the provisional accuracy winner on the frozen 600 (WER 0.06187, statistically
 * better than both v2 and int8) says nothing about whether it can serve a real session — which is
 * exactly why "moonshine ships" would be an unsupported claim today.
 *
 * SCOPE, deliberately narrow: lifecycle parity with the existing Private STT contract, candidate-aware
 * metadata, explicit failure, and reachability for internal testing only. NOT in scope: activation, any
 * production-default change, the generic config selector, or any URL/localStorage selection path.
 */

/** The 3-second live window the product decodes from, distinct from the full-utterance final pass. */
export const LIVE_WINDOW_SECONDS = 3;
const TARGET_SAMPLE_RATE = 16_000;

export type MoonshineArch = 'MOONSHINE_STREAMING_MEDIUM' | 'MOONSHINE_STREAMING_SMALL';

export interface MoonshineEngineOptions {
    /** Which candidate this instance IS. Recorded in metadata; never inferred from a default. */
    candidateId: string;
    modelArch: MoonshineArch;
    /** Injected so tests drive the real lifecycle without loading a 318 MB model. */
    loadTranscriber?: (arch: MoonshineArch) => Promise<MoonshineTranscriber>;
    onDownloadProgress?: (fraction: number) => void;
}

export interface MoonshineTranscriber {
    transcribe(audio: Float32Array): Promise<{ lines?: { text?: string }[]; text?: string }>;
    /** Optional in the published runtime; called when present so workers are not leaked. */
    destroy?(): Promise<void> | void;
}

/**
 * What actually ran. Every field is OBSERVED, never defaulted.
 *
 * `PrivateSTT.getMetadata()` reads its model identity from `PRIV_STT_V4_DEFAULT_VARIANT`, so a session
 * running one v4 candidate reports another. An identity taken from a default is not evidence, and an
 * int8 human test recorded as q4 is worse than no record at all.
 */
export interface MoonshineEngineMetadata {
    candidateId: string;
    engine: 'moonshine_streaming';
    modelArch: MoonshineArch;
    runtime: '@moonshine-ai/moonshine-wasm';
    backend: 'wasm';
    liveWindowSeconds: number;
    /** Set only once a decode has actually happened. Null means "not established", never a guess. */
    firstDecodeAt: number | null;
    /** Set when the engine failed. Failure is reported, never swallowed into a fallback. */
    failure: { phase: 'init' | 'start' | 'decode' | 'stop'; message: string } | null;
}

export class MoonshineStreamingEngine implements STTStrategy {
    private transcriber: MoonshineTranscriber | null = null;
    private mic: MicStream | null = null;
    private detachFrames: (() => void) | null = null;
    private buffer: Float32Array[] = [];
    private committed = '';
    private interim = '';
    private lastHeartbeat = 0;
    private failure: MoonshineEngineMetadata['failure'] = null;
    /**
     * FIRST failure wins. A start that fails because init failed is a SYMPTOM; overwriting the init
     * message with it would hide the root cause behind its own consequence — the same reason a close
     * failure must never mask the sync failure that preceded it.
     */
    private recordFailure(phase: NonNullable<MoonshineEngineMetadata['failure']>['phase'], message: string): void {
        this.failure ??= { phase, message };
    }
    private firstDecodeAt: number | null = null;
    private decoding = false;

    constructor(private readonly options: MoonshineEngineOptions) {}

    getEngineType(): string { return 'moonshine_streaming'; }
    getLastHeartbeatTimestamp(): number { return this.lastHeartbeat; }

    /**
     * NO SILENT FALLBACK. An unavailable engine says so; it never quietly becomes another model. The
     * caller decides whether a configured fallback applies, and that decision is recorded.
     */
    async checkAvailability(): Promise<AvailabilityResult> {
        if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
            return { isAvailable: false, reason: 'UNSUPPORTED', message: 'WebAssembly worker unavailable' };
        }
        return { isAvailable: true };
    }

    async init(timeoutMs = 60_000): Promise<Result<void, Error>> {
        try {
            const load = this.options.loadTranscriber ?? defaultLoadTranscriber;
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`moonshine init exceeded ${timeoutMs}ms`)), timeoutMs));
            this.transcriber = await Promise.race([load(this.options.modelArch), timeout]);
            this.lastHeartbeat = Date.now();
            return { isOk: true, data: undefined };
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.recordFailure('init', err.message);
            return { isOk: false, error: err };
        }
    }

    async start(mic?: MicStream): Promise<void> {
        if (!this.transcriber) {
            const err = new Error('moonshine start before a successful init');
            this.recordFailure('start', err.message);
            throw err;
        }
        this.buffer = []; this.committed = ''; this.interim = '';
        if (!mic) return;
        this.mic = mic;
        this.detachFrames = mic.onFrame((frame) => {
            this.buffer.push(frame);
            void this.decodeLiveWindow(mic.sampleRate || TARGET_SAMPLE_RATE);
        });
    }

    /**
     * THE LIVE PATH decodes a RECENT WINDOW, not the whole buffer — which is why the frozen 600, a
     * full-utterance benchmark, cannot validate it. Boundary loss and duplication are properties of the
     * window, and only a windowed test can measure them.
     */
    private async decodeLiveWindow(sampleRate: number): Promise<void> {
        if (this.decoding || !this.transcriber) return;
        this.decoding = true;
        try {
            const window = takeTail(this.buffer, LIVE_WINDOW_SECONDS * sampleRate);
            if (window.length === 0) return;
            this.interim = textOf(await this.transcriber.transcribe(window));
            this.firstDecodeAt ??= Date.now();
            this.lastHeartbeat = Date.now();
        } catch (e) {
            this.recordFailure('decode', e instanceof Error ? e.message : String(e));
        } finally {
            this.decoding = false;
        }
    }

    /** STOP decodes the FULL accumulated buffer — the final transcript is not a concatenation of windows. */
    async stop(): Promise<void> {
        this.detachFrames?.(); this.detachFrames = null;
        if (!this.transcriber) return;
        try {
            const all = concat(this.buffer);
            if (all.length > 0) this.committed = textOf(await this.transcriber.transcribe(all));
            this.lastHeartbeat = Date.now();
        } catch (e) {
            this.recordFailure('stop', e instanceof Error ? e.message : String(e));
            throw e instanceof Error ? e : new Error(String(e));
        }
    }

    async pause(): Promise<void> { this.detachFrames?.(); this.detachFrames = null; }
    async resume(): Promise<void> {
        if (this.mic && !this.detachFrames) {
            const mic = this.mic;
            this.detachFrames = mic.onFrame((frame) => {
                this.buffer.push(frame);
                void this.decodeLiveWindow(mic.sampleRate || TARGET_SAMPLE_RATE);
            });
        }
    }

    /** Nuclear cleanup. A leaked worker outlives the session and quietly holds hundreds of MB. */
    async terminate(): Promise<void> {
        this.detachFrames?.(); this.detachFrames = null;
        this.mic = null; this.buffer = [];
        try { await this.transcriber?.destroy?.(); } finally { this.transcriber = null; }
    }

    async getTranscript(): Promise<string> { return this.committed || this.interim; }
    getInterimTranscript(): string { return this.interim; }

    getMetadata(): MoonshineEngineMetadata {
        return {
            candidateId: this.options.candidateId,
            engine: 'moonshine_streaming',
            modelArch: this.options.modelArch,
            runtime: '@moonshine-ai/moonshine-wasm',
            backend: 'wasm',
            liveWindowSeconds: LIVE_WINDOW_SECONDS,
            firstDecodeAt: this.firstDecodeAt,
            failure: this.failure,
        };
    }
}

/** `{ lines: [{ text }] }` — scoring the JSON instead of the text once read as WER 2.0. */
function textOf(result: { lines?: { text?: string }[]; text?: string }): string {
    if (Array.isArray(result?.lines)) return result.lines.map((l) => l?.text ?? '').join(' ').trim();
    return (result?.text ?? '').trim();
}

function concat(frames: readonly Float32Array[]): Float32Array {
    const total = frames.reduce((n, f) => n + f.length, 0);
    const out = new Float32Array(total);
    let at = 0;
    for (const f of frames) { out.set(f, at); at += f.length; }
    return out;
}

function takeTail(frames: readonly Float32Array[], samples: number): Float32Array {
    const all = concat(frames);
    return all.length <= samples ? all : all.subarray(all.length - samples);
}

/**
 * The published ESM calls `__name(...)` without defining it — a PACKAGING gap in the dependency that the
 * consumer's bundler normally fills. Without the identity shim the module dies before any model loads.
 */
async function defaultLoadTranscriber(arch: MoonshineArch): Promise<MoonshineTranscriber> {
    const g = globalThis as unknown as { __name?: (t: unknown, v?: unknown) => unknown };
    g.__name ??= (target) => target;
    const lib = await import('@moonshine-ai/moonshine-wasm') as unknown as {
        Transcriber: { load: (o: Record<string, unknown>) => Promise<MoonshineTranscriber> };
        ModelArch: Record<string, number>;
    };
    return lib.Transcriber.load({ language: 'en', modelArch: lib.ModelArch[arch] });
}
