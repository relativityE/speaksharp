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
    /** The INSTALLED runtime version and the asset identity actually loaded. Null until observed. */
    runtimeVersion: string | null;
    assetIdentity: string | null;
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
    private runtimeVersion: string | null = null;
    private assetIdentity: string | null = null;
    /** Once the final pass has run, no late interim decode may replace its result. */
    private finalized = false;
    /** The in-flight decode, if any. Inference is SERIALIZED: the runtime is one worker. */
    private inFlight: Promise<void> | null = null;
    /** A frame arrived mid-decode, so one more interim decode is owed once the current one settles. */
    private pendingWindow = false;

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
            const load = this.options.loadTranscriber
                ?? ((arch: MoonshineArch) => defaultLoadTranscriber(arch, this.options.onDownloadProgress));
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`moonshine init exceeded ${timeoutMs}ms`)), timeoutMs));
            this.transcriber = await Promise.race([load(this.options.modelArch), timeout]);
            const identified = this.transcriber as MoonshineTranscriber & {
                version?: string; modelId?: string; assetDigest?: string;
            };
            this.runtimeVersion = identified.version ?? null;
            this.assetIdentity = identified.assetDigest ?? identified.modelId ?? null;
            this.lastHeartbeat = Date.now();
            return { isOk: true, data: undefined };
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.recordFailure('init', err.message);
            return { isOk: false, error: err };
        }
    }

    /**
     * The runtime expects 16 kHz mono. Handing it 48 kHz frames does not error — it silently decodes
     * audio three times too fast, producing plausible nonsense. A wrong sample rate must be REFUSED, not
     * interpreted, because a wrong transcript is worse than a missing one.
     */
    private assertSampleRate(rate: number): void {
        if (rate !== TARGET_SAMPLE_RATE) {
            throw new Error(
                `moonshine requires ${TARGET_SAMPLE_RATE} Hz mono; the microphone supplied ${rate} Hz. `
                + 'Resample upstream — decoding at the wrong rate produces confident nonsense.',
            );
        }
    }

    async start(mic?: MicStream): Promise<void> {
        if (!this.transcriber) {
            const err = new Error('moonshine start before a successful init');
            this.recordFailure('start', err.message);
            throw err;
        }
        this.buffer = []; this.committed = ''; this.interim = ''; this.finalized = false;
        if (!mic) return;
        try {
            this.assertSampleRate(mic.sampleRate || TARGET_SAMPLE_RATE);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.recordFailure('start', err.message);
            throw err;
        }
        this.mic = mic;
        this.detachFrames = mic.onFrame((frame) => {
            this.buffer.push(frame);
            this.scheduleLiveWindow(mic.sampleRate || TARGET_SAMPLE_RATE);
        });
    }

    /**
     * THE LIVE PATH decodes a RECENT WINDOW, not the whole buffer — which is why the frozen 600, a
     * full-utterance benchmark, cannot validate it. Boundary loss and duplication are properties of the
     * window, and only a windowed test can measure them.
     */
    private scheduleLiveWindow(sampleRate: number): void {
        // Frames arriving DURING a decode are not dropped — they are coalesced into exactly one more
        // decode when the current one settles. Dropping them silently stales the interim transcript;
        // queueing one per frame would pile decodes onto a single-worker runtime without bound.
        if (this.inFlight) { this.pendingWindow = true; return; }
        this.inFlight = this.decodeLiveWindow(sampleRate).finally(() => {
            this.inFlight = null;
            if (this.pendingWindow) { this.pendingWindow = false; this.scheduleLiveWindow(sampleRate); }
        });
    }

    private async decodeLiveWindow(sampleRate: number): Promise<void> {
        if (!this.transcriber) return;
        try {
            const window = takeTail(this.buffer, LIVE_WINDOW_SECONDS * sampleRate);
            if (window.length === 0) return;
            // No post-finalization guard is needed here: stop() detaches the frame handler, clears
            // pendingWindow, and AWAITS inFlight before it finalizes, and resume() refuses to reattach
            // afterwards — so no live decode can still be running once `finalized` is set.
            this.interim = textOf(await this.transcriber.transcribe(window));
            this.firstDecodeAt ??= Date.now();
            this.lastHeartbeat = Date.now();
        } catch (e) {
            this.recordFailure('decode', e instanceof Error ? e.message : String(e));
        }
    }

    /** STOP decodes the FULL accumulated buffer — the final transcript is not a concatenation of windows. */
    async stop(): Promise<void> {
        this.detachFrames?.(); this.detachFrames = null;
        // AWAIT the in-flight decode before the final pass. Two concurrent transcribe() calls on a
        // single-worker runtime race, and a live decode settling after the final one would overwrite the
        // final transcript with a 3-second window — the user would see the last three seconds of their
        // session presented as the whole thing.
        this.pendingWindow = false;
        try { await this.inFlight; } catch { /* the live failure is already recorded */ }
        if (!this.transcriber) return;
        try {
            const all = concat(this.buffer);
            if (all.length > 0) this.committed = textOf(await this.transcriber.transcribe(all));
            this.finalized = true;
            this.lastHeartbeat = Date.now();
        } catch (e) {
            this.recordFailure('stop', e instanceof Error ? e.message : String(e));
            throw e instanceof Error ? e : new Error(String(e));
        }
    }

    async pause(): Promise<void> { this.detachFrames?.(); this.detachFrames = null; }
    async resume(): Promise<void> {
        // Resuming a FINALIZED session would append fresh audio to a buffer whose transcript has already
        // been delivered, and restart live decodes against it. The session is over; refuse.
        if (this.finalized) throw new Error('Cannot resume a finalized session; start a new session instead.');
        if (this.mic && !this.detachFrames) {
            const mic = this.mic;
            this.detachFrames = mic.onFrame((frame) => {
                this.buffer.push(frame);
                this.scheduleLiveWindow(mic.sampleRate || TARGET_SAMPLE_RATE);
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
            // OBSERVED, not asserted. Null means "not established" — never a constant standing in for a
            // fact, which is exactly how PrivateSTT reports one v4 candidate as another.
            runtimeVersion: this.runtimeVersion,
            assetIdentity: this.assetIdentity,
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
/**
 * OUR token is not the runtime's. `ModelArch` declares `SmallStreaming` / `MediumStreaming`; indexing it
 * with `MOONSHINE_STREAMING_MEDIUM` yields `undefined`, and an undefined arch either throws or selects
 * the enum's zero member (`Tiny`) — a different, much smaller model reporting itself as the one we
 * selected. That is the exact "identity taken from a default" failure this engine exists to prevent, and
 * no test with an injected transcriber can see it, because only the DEFAULT loader touches the enum.
 */
export const RUNTIME_ARCH_MEMBER: Readonly<Record<MoonshineArch, string>> = Object.freeze({
    MOONSHINE_STREAMING_SMALL: 'SmallStreaming',
    MOONSHINE_STREAMING_MEDIUM: 'MediumStreaming',
});

/** Resolve OUR token against the runtime's enum, failing closed rather than passing `undefined`. */
export function resolveModelArch(modelArch: Record<string, unknown>, arch: MoonshineArch): number {
    const member = RUNTIME_ARCH_MEMBER[arch];
    const value = modelArch[member];
    if (typeof value !== 'number') {
        throw new Error(
            `moonshine runtime does not declare ModelArch.${member} for ${arch}; `
            + `available: ${Object.keys(modelArch).filter((k) => !/^\d+$/.test(k)).join(', ')}`,
        );
    }
    return value;
}

async function defaultLoadTranscriber(
    arch: MoonshineArch,
    onDownloadProgress?: (fraction: number) => void,
): Promise<MoonshineTranscriber> {
    const g = globalThis as unknown as { __name?: (t: unknown, v?: unknown) => unknown };
    g.__name ??= (target) => target;
    const lib = await import('@moonshine-ai/moonshine-wasm') as unknown as {
        Transcriber: { load: (o: Record<string, unknown>) => Promise<MoonshineTranscriber> };
        ModelArch: Record<string, unknown>;
    };
    // Wired through to the runtime rather than declared and ignored. A progress callback that is never
    // called is worse than none: the UI would show a frozen bar and read as a hang.
    return lib.Transcriber.load({
        language: 'en',
        modelArch: resolveModelArch(lib.ModelArch, arch),
        ...(onDownloadProgress ? { onProgress: (f: number) => onDownloadProgress(f) } : {}),
    });
}
