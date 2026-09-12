import type { MicStream } from '../utils/types';
import type { Result } from '../modes/types';
import type { AvailabilityResult, STTStrategy } from '../STTStrategy';
import { CANDIDATES, identityOf, isCompleteIdentity, type CandidateId } from '../candidateRegistry';
import { fetchVerifiedAssets, pinnedAssetsFor, pinnedTotalBytes } from '../moonshineAssetPins';

/** Only the registered Moonshine candidates may back this engine. */
export type MoonshineCandidateId = Extract<CandidateId, `moonshine:${string}`>;

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
    /**
     * Which REGISTERED candidate this instance IS. A registry id, not a free string, so the configured
     * identity cannot be invented at the call site.
     */
    candidateId: MoonshineCandidateId;
    modelArch: MoonshineArch;
    /** Injected so tests drive the real lifecycle without loading a 318 MB model. */
    loadTranscriber?: (arch: MoonshineArch) => Promise<MoonshineTranscriber>;
    /**
     * Where the configured identity comes from. Defaults to the registry.
     *
     * Exists so the identity REFUSALS below stay provable without a deficient real candidate. Proving
     * "a candidate with no pin digest is refused" by pointing at whichever registered candidate happens
     * to lack one makes the test die the moment that candidate is fixed — and it did: this was asserted
     * against v2:base.en, which has carried a digest since the registry landed, so the case silently
     * stopped being able to fail. The mechanism has to be testable on its own.
     */
    candidateSource?: (id: MoonshineCandidateId) => typeof CANDIDATES[CandidateId] | undefined;
    onDownloadProgress?: (fraction: number) => void;
}

/** A live session. The runtime accumulates state across `addAudio` calls BY DESIGN. */
export interface MoonshineStream {
    start(): void;
    /** Cheap: buffers audio. Does NOT decode. */
    addAudio(audio: Float32Array, sampleRate: number, flags?: number): void;
    /**
     * Runs a pass and returns the current snapshot. A pass that comes too soon returns the previous
     * snapshot instead of entering the engine, unless ForceUpdate insists.
     */
    transcribe(flags?: number): { lines?: { text?: string }[]; text?: string };
    stop(): void;
    close(): void;
}

/** `TranscribeFlags.ForceUpdate` — insists on a pass that the interval would otherwise hold back. */
export const FORCE_UPDATE = 1;

/**
 * Closed at most once, whoever gets there first.
 *
 * The timeout continuation and the post-await supersede check can both reach the same transcriber, and
 * on the superseded path both did. `Transcriber.close()` is not documented as idempotent, so a second
 * call is at best wasted and at worst throws inside teardown — the one place an exception is least
 * welcome. Ownership is settled here rather than by reasoning about which path wins the race.
 */
const CLOSED = new WeakSet<object>();
function closeOnce(t: MoonshineTranscriber | null | undefined): void {
    if (!t || CLOSED.has(t)) return;
    CLOSED.add(t);
    try { t.close(); } catch { /* teardown must not throw over the original failure */ }
}

export interface MoonshineTranscriber {
    /**
     * SYNCHRONOUS, and returns a Transcript. This was typed as returning a Promise, which TypeScript
     * accepted because awaiting a non-Promise is legal — so the mistake could not surface as a type
     * error, only as behaviour.
     */
    transcribe(audio: Float32Array, options?: { sampleRate?: number }): { lines?: { text?: string }[]; text?: string };
    /**
     * THE STREAMING ENTRY POINT. Required: this engine drives a continuous session, and the
     * whole-buffer `transcribe()` is documented as the NON-streaming call.
     */
    createStream?(options?: Record<string, unknown>): MoonshineStream;
    /**
     * THE RUNTIME'S ACTUAL TEARDOWN. This interface declared `destroy?()`, which the published
     * `Transcriber` does not have — so every `destroy?.()` call site optional-chained to `undefined` and
     * did nothing. The leak the timeout fix was written to close was still leaking: the checks passed
     * because the test doubles implemented the method the interface invented.
     *
     * Not optional any more. A double that omits it now fails to compile, which is the only way this
     * class of error gets caught before production.
     */
    close(): void;
}

/**
 * What actually ran. Every field is OBSERVED, never defaulted.
 *
 * `PrivateSTT.getMetadata()` reads its model identity from `PRIV_STT_V4_DEFAULT_VARIANT`, so a session
 * running one v4 candidate reports another. An identity taken from a default is not evidence, and an
 * int8 human test recorded as q4 is worse than no record at all.
 */
/**
 * CONFIGURED PROVENANCE AND OBSERVED EXECUTION ARE SEPARATE, AND MUST STAY SEPARATE.
 *
 * The runtime exposes NO version and NO model id — `runtimeVersion`/`assetIdentity` came back null from
 * the real runtime in both probe runs. Waiting for the runtime to introspect itself therefore leaves
 * every human session unattributable, which is what blocks A/B use.
 *
 * The identity is instead CONFIGURED: checked-in facts from the typed candidate registry, verified
 * against the lockfile and the committed pin table by test. They are not introspected from the
 * transcriber and must never be described as though they were. Observed facts — did init succeed, when
 * was the first decode, which backend, was a Worker seen — stay in their own object, because merging
 * them is how configuration gets reported as measurement.
 */
export interface MoonshineEngineMetadata {
    candidateId: string;
    engine: 'moonshine_streaming';
    modelArch: MoonshineArch;
    /** CONFIGURED: from the candidate registry. Never introspected. */
    configuredRuntime: { package: string; version: string };
    configuredModel: { model: string; revision: string | null; pinDigest: string | null };
    /** OBSERVED: what this run actually did. */
    observedExecution: {
        initSucceeded: boolean;
        firstDecodeAt: number | null;
        backend: 'wasm';
        /**
         * Whether a Worker was seen. `null` means NOT DETERMINED — the engine does not monkey-patch
         * `Worker` in product code to find out, and a guessed `false` would read as proof that
         * inference runs on the main thread. The responsiveness probe determines this properly.
         */
        workerObserved: boolean | null;
    };
    liveWindowSeconds: number;
    /** Set when the engine failed. Failure is reported, never swallowed into a fallback. */
    failure: { phase: 'init' | 'start' | 'decode' | 'stop'; message: string } | null;
}

export class MoonshineStreamingEngine implements STTStrategy {
    private transcriber: MoonshineTranscriber | null = null;
    /**
     * Bumped by `terminate()` and by each `init()`. A load that is still running when its init settles
     * belongs to a superseded generation, and whatever it eventually produces must be destroyed rather
     * than adopted.
     */
    private generation = 0;
    private mic: MicStream | null = null;
    private detachFrames: (() => void) | null = null;
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
    /**
     * Whether a Worker was constructed while this engine was loading. NOT DETERMINED by default: the
     * engine will not patch `Worker` in product code, and a guessed `false` would read as evidence that
     * inference blocks the main thread. The responsiveness probe observes this properly and injects it.
     */
    /** The live session. Created at start(), closed at terminate()/stop(). */
    private stream: MoonshineStream | null = null;

    private workerObserved: boolean | null = null;

    /** Test/probe seam: record an externally observed Worker creation as an OBSERVED fact. */
    public noteWorkerObserved(observed: boolean): void { this.workerObserved = observed; }
    /** Once the final pass has run, no late interim decode may replace its result. */
    private finalized = false;
    /** The in-flight decode, if any. Inference is SERIALIZED: the runtime is one worker. */
    private inFlight: Promise<void> | null = null;
    /** A frame arrived mid-decode, so one more interim decode is owed once the current one settles. */
    private pendingWindow = false;

    constructor(private readonly options: MoonshineEngineOptions) {}

    /**
     * The provider id `PrivateSTT` routes on. Distinct from `getEngineType()`, which is the engine's
     * own legacy label — conflating them would make the facade's routing key depend on a string chosen
     * for telemetry.
     */
    public readonly type = 'moonshine-streaming' as const;
    /**
     * #1405s — every live result from this engine is the COMPLETE transcript so far, not the
     * newly decoded piece: `transcribe()` returns the current snapshot. Accumulating snapshots
     * duplicates text, so the facade replaces the visible draft instead of appending to it.
     */
    readonly liveResultKind = 'snapshot' as const;

    /**
     * Options are fixed for this engine's lifetime: which candidate it IS was decided at construction,
     * and a mid-session change would mean the running model no longer matched the identity it reports.
     * Accepted and ignored so the facade's interface is satisfied without inventing mutability.
     */
    public updateOptions(): void { /* identity is immutable for the life of the engine */ }

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
            // FAIL CLOSED ON INCOMPLETE IDENTITY, before any weights are fetched. A session that cannot
            // say which model produced its transcript is not usable as A/B evidence, and discovering
            // that after a 147 MB download and a full recording wastes the participant's time as well.
            const candidate = (this.options.candidateSource ?? ((id) => CANDIDATES[id]))(this.options.candidateId);
            if (!candidate || !isCompleteIdentity(identityOf(candidate))) {
                throw new Error(
                    `candidate ${this.options.candidateId} has no complete configured identity; `
                    + 'refusing to start an unattributable session',
                );
            }
            if (!candidate.assets.pinDigest) {
                throw new Error(
                    `candidate ${this.options.candidateId} has no committed asset pin digest; `
                    + 'refusing to start a session whose model bytes cannot be identified',
                );
            }
            const load = this.options.loadTranscriber
                ?? ((arch: MoonshineArch) => defaultLoadTranscriber(arch, this.options.onDownloadProgress, candidate.model.id));

            // THE ABANDONED LOADER. `Promise.race` only decides which promise this function waits for —
            // it does not cancel the loser. When the timeout won, `load()` kept running: it finished
            // fetching ~147 MB, spun up its worker and WASM runtime, and resolved to a transcriber that
            // nothing held and nothing destroyed. The user saw an init failure while a full second
            // runtime stayed resident, and starting the next attempt stacked another one behind it.
            //
            // So the load is followed to its OWN conclusion regardless of who won: whatever it produces
            // after this init has settled is destroyed, not adopted. `myGeneration` is the test —
            // `terminate()` and a subsequent `init()` both bump it, which also covers the case where the
            // user gives up and switches models while a load is still in flight.
            const myGeneration = ++this.generation;
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const loading = Promise.resolve(load(this.options.modelArch));
            loading.then(
                (late) => {
                    if (settled || this.generation !== myGeneration) {
                        // Fire-and-forget: nobody is waiting on this, and a failed destroy of an
                        // already-orphaned runtime must not become an unhandled rejection.
                        closeOnce(late);
                    }
                },
                () => { /* the rejection is surfaced through the await below when it wins the race */ },
            );

            let loaded: MoonshineTranscriber;
            try {
                loaded = await new Promise<MoonshineTranscriber>((resolve, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`moonshine init exceeded ${timeoutMs}ms`)),
                        timeoutMs,
                    );
                    loading.then(resolve, reject);
                });
            } finally {
                settled = true;
                // Left dangling by the old race, this kept a 60s timer alive on every successful init.
                if (timer !== undefined) clearTimeout(timer);
            }

            const identified = loaded as MoonshineTranscriber & {
                version?: string; modelId?: string; assetDigest?: string;
            };
            // If the runtime DOES start reporting these, they are cross-checked against the configured
            // values rather than replacing them — a mismatch means the loaded bytes are not the ones the
            // registry describes, which must fail rather than be quietly recorded.
            if (identified.version && identified.version !== candidate.runtime.version) {
                // DESTROY BEFORE THROWING. This check previously ran after `this.transcriber` had already
                // been assigned, so a rejected identity left the mismatched runtime installed on the
                // engine and alive — the one case where we know the loaded model is NOT what we claim.
                closeOnce(loaded);
                throw new Error(
                    `runtime reported version ${identified.version} but the registry configures `
                    + `${candidate.runtime.version}; refusing to attribute the session`,
                );
            }

            // ASSIGNED ONLY ONCE THE IDENTITY HOLDS. Everything downstream — metadata, telemetry, the
            // observed-identity check — reads this field, so it must never hold a runtime we have
            // refused to attribute. A `terminate()` that landed during the load wins over this init.
            if (this.generation !== myGeneration) {
                closeOnce(loaded);
                throw new Error('moonshine init was superseded before it completed');
            }
            this.transcriber = loaded;
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
        this.committed = ''; this.interim = ''; this.finalized = false;
        if (!mic) return;
        try {
            this.assertSampleRate(mic.sampleRate || TARGET_SAMPLE_RATE);
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            this.recordFailure('start', err.message);
            throw err;
        }
        // FAIL CLOSED without the streaming API. Falling back to the whole-buffer `transcribe()` per
        // window is precisely the misuse that made every clip's output depend on the one before it in
        // the benchmark; silently doing it here would put that defect in front of a user.
        if (typeof this.transcriber?.createStream !== 'function') {
            const err = new Error(
                'moonshine runtime exposes no createStream(); refusing to drive a continuous session '
                + 'through the non-streaming whole-buffer API',
            );
            this.recordFailure('start', err.message);
            throw err;
        }
        this.stream = this.transcriber.createStream();
        this.stream.start();

        this.mic = mic;
        this.detachFrames = mic.onFrame((frame) => {
            // Hand audio over as it arrives; the stream buffers and decides when a pass is worth making.
            this.stream?.addAudio(frame, mic.sampleRate || TARGET_SAMPLE_RATE);
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

    private async decodeLiveWindow(_sampleRate: number): Promise<void> {
        if (!this.stream) return;
        try {
            // ASK THE STREAM, do not re-decode a slice. Audio was already handed over by `addAudio` as
            // it arrived; a pass reads what the session has accumulated.
            //
            // No ForceUpdate here: the runtime holds a pass back until there is enough new audio to say
            // something new, and forcing on every frame would pay the per-pass overhead many times a
            // second and fall further behind the speaker on each one.
            this.interim = textOf(this.stream.transcribe());
            this.firstDecodeAt ??= Date.now();
            this.lastHeartbeat = Date.now();
        } catch (e) {
            this.recordFailure('decode', e instanceof Error ? e.message : String(e));
        }
    }

    /** STOP decodes the FULL accumulated buffer — the final transcript is not a concatenation of windows. */
    /**
     * THE AUTHORITATIVE FINAL PASS, performed exactly once.
     *
     * Both `stop()` and the facade's commit decode need the session's final result, and the shipping
     * order reaches the commit decode FIRST -- `PrivateWhisper.onStop` never calls the engine's `stop()`
     * at all. So whichever arrives first finalizes, and the other reuses it. Two entry points each doing
     * their own decode is how the same take was inferred twice.
     */
    private async finalizeSession(): Promise<void> {
        if (this.finalized || !this.stream) return;
        this.pendingWindow = false;
        // AWAIT the in-flight live decode first. Two concurrent transcribe() calls on a single-worker
        // runtime race, and a live decode settling after the final one would overwrite the final
        // transcript with a 3-second window -- the user would see the last three seconds presented as
        // the whole session.
        try { await this.inFlight; } catch { /* the live failure is already recorded */ }
        if (!this.stream) return;
        try {
            // THE SAME SESSION, forced. Not a fresh stream over the processed buffer: that stream has
            // none of the session's accumulated state, so trailing words it had already committed come
            // back missing and the user watches the end of their sentence disappear.
            this.committed = textOf(this.stream.transcribe(FORCE_UPDATE));
            this.finalized = true;
            this.lastHeartbeat = Date.now();
        } catch (e) {
            this.recordFailure('stop', e instanceof Error ? e.message : String(e));
            throw e instanceof Error ? e : new Error(String(e));
        } finally {
            try { this.stream.stop(); } finally { this.stream.close(); this.stream = null; }
        }
    }

    async stop(): Promise<void> {
        this.detachFrames?.(); this.detachFrames = null;
        // AWAIT the in-flight decode before the final pass. Two concurrent transcribe() calls on a
        // single-worker runtime race, and a live decode settling after the final one would overwrite the
        // final transcript with a 3-second window — the user would see the last three seconds of their
        // session presented as the whole thing.
        // Delegates, so a stop that follows an already-finalized commit decode does not decode again.
        await this.finalizeSession();
    }

    async pause(): Promise<void> { this.detachFrames?.(); this.detachFrames = null; }
    async resume(): Promise<void> {
        // Resuming a FINALIZED session would append fresh audio to a buffer whose transcript has already
        // been delivered, and restart live decodes against it. The session is over; refuse.
        if (this.finalized) throw new Error('Cannot resume a finalized session; start a new session instead.');
        if (this.mic && !this.detachFrames) {
            const mic = this.mic;
            this.detachFrames = mic.onFrame((frame) => {
                this.stream?.addAudio(frame, mic.sampleRate || TARGET_SAMPLE_RATE);
                this.scheduleLiveWindow(mic.sampleRate || TARGET_SAMPLE_RATE);
            });
        }
    }

    /** Nuclear cleanup. A leaked worker outlives the session and quietly holds hundreds of MB. */
    async terminate(): Promise<void> {
        // Bump FIRST: a load still in flight is now superseded, so its eventual transcriber is destroyed
        // by the init continuation instead of being installed on a terminated engine.
        this.generation++;
        this.detachFrames?.(); this.detachFrames = null;
        try { this.stream?.close(); } catch { /* already closed */ } finally { this.stream = null; }
        this.mic = null;
        try { closeOnce(this.transcriber); } finally { this.transcriber = null; }
    }

    /**
     * THE FACADE METHOD A REAL RECORDING USES.
     *
     * `PrivateWhisper` commits an utterance by calling `privateSTT.transcribe(audio)`, which forwards to
     * `engine.transcribe(audio)`. This engine did not implement it at all — and `validateEngine` only
     * requires `init`, `start` and `stop`, so the engine passed construction and every initialisation
     * test, then would have thrown "not a function" at the first real commit decode. Every proof so far
     * exercised init and the streaming pass; none used the method an actual recording goes through.
     *
     * DECODED ON ITS OWN STREAM, not the session's. The session stream is already being fed by mic
     * frames, so pushing the same utterance into it would decode that audio twice — the transcript would
     * gain a duplicated passage, which reads as a model defect rather than a plumbing one. A short-lived
     * stream keeps the whole-buffer decode isolated and cannot carry state into the next session.
     */
    async transcribe(audio: Float32Array, options?: { final?: boolean }): Promise<Result<string, Error>> {
        // A FINALIZED SESSION IS ALREADY DECODED. `stop()` runs the forced final pass over the session
        // stream and commits the result; `PrivateWhisper` then calls this to commit the utterance. On a
        // streaming arch that meant the SAME audio was inferred twice — once by the session stream that
        // had heard the whole take, and again on a fresh stream built from the processed buffer.
        //
        // The second result wins, and it is the weaker one: a stream that has just been handed a buffer
        // has none of the session's accumulated state, so trailing words the session had already
        // committed can come back missing. The user sees the end of their sentence disappear, and it
        // reads as the model dropping words rather than as the pipeline decoding twice.
        //
        // The committed transcript is returned instead. It is not a cache of this call's argument — it
        // is the result of decoding the same take, by the stream that actually heard it.
        //
        // FINALIZATION IS THE AUTHORITY, NOT A NON-EMPTY STRING. This tested `finalized && committed`,
        // so a take that legitimately committed an EMPTY transcript — silence, a mis-start, a user who
        // said nothing — fell through to a fresh inference anyway. That is the exact case where a second
        // decode is most likely to invent something out of noise, and the empty result was the honest
        // one.
        // FINALITY COMES FROM THE CALLER, because the engine cannot tell these two apart.
        //
        // `PrivateWhisper` calls `transcribe` on a timer during recording AND once at stop; both arrive
        // here as a Float32Array. The previous version finalized whenever a live session existed, which
        // closed the session stream on the FIRST live decode and silently dropped the rest of the user's
        // speech -- a worse defect than the double inference it was fixing, and one the leaf-engine tests
        // could not see because they never drove the live loop at all.
        //
        // `processAudio({ force: true })` is the stop-commit; every other call is a live window.
        const isFinal = options?.final === true;

        if (this.finalized) {
            // Already committed by whichever entry point arrived first. Never decode again.
            return { isOk: true, data: this.committed };
        }

        if (this.stream) {
            if (isFinal) {
                // The authoritative forced pass, on the stream that heard the take.
                await this.finalizeSession();
                return { isOk: true, data: this.committed };
            }
            // A LIVE window during an open session. The session stream is already decoding on its own
            // schedule, so this reports what it has rather than opening a second stream over the same
            // audio -- and above all it does not close anything.
            return { isOk: true, data: this.interim };
        }
        if (!this.transcriber) {
            const err = new Error('Cannot transcribe before a successful init');
            this.recordFailure('decode', err.message);
            return { isOk: false, error: err };
        }
        let stream: MoonshineStream | null = null;
        try {
            // FAIL CLOSED without the streaming API, exactly as start() does. The transcriber's own
            // whole-buffer `transcribe()` is the NON-streaming call and is documented as unsupported on a
            // streaming arch; using it here would decode with machinery this candidate does not describe.
            stream = this.transcriber.createStream?.() ?? null;
            if (!stream) {
                throw new Error('runtime exposes no streaming API; refusing the non-streaming fallback');
            }
            stream.start();
            stream.addAudio(audio, TARGET_SAMPLE_RATE);
            const text = textOf(stream.transcribe(FORCE_UPDATE));
            this.lastHeartbeat = Date.now();
            return { isOk: true, data: text };
        } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            // RECORDED, never silently returned as empty text: an empty transcript is indistinguishable
            // from a silent recording, and would be scored against the model.
            this.recordFailure('decode', err.message);
            return { isOk: false, error: err };
        } finally {
            if (stream) { try { stream.stop(); } finally { stream.close(); } }
        }
    }

    async getTranscript(): Promise<string> { return this.committed || this.interim; }
    getInterimTranscript(): string { return this.interim; }

    getMetadata(): MoonshineEngineMetadata {
        // NEVER THROWS. An unregistered candidate is exactly the case where init failed, and this is the
        // object a caller reads to find out why — a diagnostic that crashes on the failure it describes
        // is useless. Unknown configuration is reported as empty/null, which is honest, rather than
        // faked from a default.
        const candidate = CANDIDATES[this.options.candidateId] as typeof CANDIDATES[CandidateId] | undefined;
        return {
            candidateId: this.options.candidateId,
            engine: 'moonshine_streaming',
            modelArch: this.options.modelArch,
            configuredRuntime: candidate
                ? { ...candidate.runtime }
                : { package: '@moonshine-ai/moonshine-wasm', version: '' },
            configuredModel: {
                model: candidate?.model.id ?? '',
                revision: candidate?.model.revision ?? null,
                pinDigest: candidate?.assets.pinDigest ?? null,
            },
            observedExecution: {
                initSucceeded: this.transcriber !== null,
                firstDecodeAt: this.firstDecodeAt,
                backend: 'wasm',
                workerObserved: this.workerObserved,
            },
            liveWindowSeconds: LIVE_WINDOW_SECONDS,
            failure: this.failure,
        };
    }
}

/** `{ lines: [{ text }] }` — scoring the JSON instead of the text once read as WER 2.0. */
function textOf(result: { lines?: { text?: string }[]; text?: string }): string {
    if (Array.isArray(result?.lines)) return result.lines.map((l) => l?.text ?? '').join(' ').trim();
    return (result?.text ?? '').trim();
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
/**
 * Which arch each registered Moonshine candidate IS.
 *
 * Lives HERE, with the module that owns arch knowledge, rather than in the facade: a candidate id
 * hardcoded in `PrivateSTT` is a second place the slate is written down, and the registry guard flags
 * it for exactly that reason. Absent entry means refuse — never load whichever arch happens to be
 * first and report the configured id over it.
 */
export const MOONSHINE_ARCH_BY_CANDIDATE: Readonly<Partial<Record<MoonshineCandidateId, MoonshineArch>>> = Object.freeze({
    'moonshine:streaming-medium': 'MOONSHINE_STREAMING_MEDIUM',
});

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
    modelId?: string,
): Promise<MoonshineTranscriber> {
    const g = globalThis as unknown as { __name?: (t: unknown, v?: unknown) => unknown };
    g.__name ??= (target) => target;
    const lib = await import('@moonshine-ai/moonshine-wasm') as unknown as {
        Transcriber: { load: (o: Record<string, unknown>) => Promise<MoonshineTranscriber> };
        ModelArch: Record<string, unknown>;
    };

    if (!modelId) {
        throw new Error('refusing to load Moonshine without a model id to resolve committed pins against');
    }

    // THE PINS NOW DECIDE WHAT RUNS. This called `Transcriber.load({ language, modelArch, onProgress })`,
    // which resolves the model through the vendor's CDN *catalog*: the executing bytes were whatever the
    // catalog served, while our metadata reported the committed digest regardless. A re-publish, a stale
    // edge cache or a substituted response would all have produced a session labelled with a digest
    // nothing had checked — the model-truth failure this workstream exists to prevent, arriving through
    // the supply chain instead of through the selector.
    //
    // Every component is fetched from its pinned URL and refused unless its length and SHA-256 match, and
    // only verified buffers reach the runtime. `language` is not passed at all: it is what triggers
    // catalog resolution, and leaving it in would let the runtime fall back to fetching its own copy.
    const assets = pinnedAssetsFor(modelId);
    const expectedTotal = pinnedTotalBytes(modelId);
    const loadedByFile = new Map<string, number>();
    const files = await fetchVerifiedAssets(assets, fetch, (file, loaded) => {
        // BYTE-BASED, NORMALISED ONCE. The runtime's own callback is
        // `(loaded, total, file)` — three arguments, in bytes. It was wired to a handler expecting a
        // 0..1 FRACTION, so the first component alone reported `Math.round(3_651_296 * 100)` percent.
        // Progress is accumulated per file against the pinned total instead, which is a number we
        // actually know: the runtime's `total` is optional and absent for some components.
        loadedByFile.set(file, loaded);
        const done = [...loadedByFile.values()].reduce((a, b) => a + b, 0);
        onDownloadProgress?.(Math.min(1, done / expectedTotal));
    });

    return lib.Transcriber.load({
        files,
        modelArch: resolveModelArch(lib.ModelArch, arch),
    });
}
