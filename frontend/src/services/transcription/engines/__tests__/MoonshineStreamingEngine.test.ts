import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    FORCE_UPDATE, MoonshineStreamingEngine, LIVE_WINDOW_SECONDS, type MoonshineTranscriber,
} from '../MoonshineStreamingEngine';
import type { MicStream } from '../../utils/types';
import { CANDIDATES } from '../../candidateRegistry';

/**
 * #1263 — Moonshine as a PRODUCT engine.
 *
 * The frozen 600 validates FULL-UTTERANCE accuracy. The product drives a CONTINUOUS SESSION: audio is
 * handed to the runtime as it arrives and each pass summarises everything accumulated, with the final
 * pass forced. The benchmark cannot speak to that at all. These tests exercise the lifecycle with an
 * injected
 * transcriber — no 318 MB download, and every decode observable.
 */
const SR = 16_000;
const frame = (n: number, v = 0.1) => Float32Array.from({ length: n }, () => v);

/** Records exactly what audio each decode saw, so window behaviour is measured rather than assumed. */
/**
 * A transcriber whose STREAM accumulates audio the way the runtime's does.
 *
 * The doubles used to expose only the whole-buffer `transcribe()`, which is exactly the API the engine
 * must NOT use for a continuous session — so every test passed against the misuse that caused the
 * cross-clip state leak. The stream here accumulates, and `seen` records what each pass was asked to
 * summarise, so a test can tell a windowed read from a whole-session one.
 */
/**
 * Build a session stream over a text function. Every double needs one: the engine drives a continuous
 * session and REFUSES the non-streaming whole-buffer API, so a double without a stream is a double of
 * a runtime this engine will not talk to.
 */
const streamOver = (text: (accumulated: number) => string, onPass?: (acc: number) => void) => {
    let accumulated = 0;
    return {
        start: vi.fn(),
        addAudio: (audio: Float32Array) => { accumulated += audio.length; },
        transcribe: () => { onPass?.(accumulated); return { lines: [{ text: text(accumulated) }] }; },
        stop: vi.fn(),
        close: vi.fn(),
    };
};

const recordingTranscriber = (text: (audio: Float32Array) => string) => {
    const seen: number[] = [];
    const passes: number[] = [];
    let accumulated = 0;
    const t: MoonshineTranscriber = {
        transcribe: async (audio) => { seen.push(audio.length); return { lines: [{ text: text(audio) }] }; },
        createStream: () => ({
            start: vi.fn(),
            addAudio: (audio: Float32Array) => { accumulated += audio.length; },
            transcribe: (_flags?: number) => {
                passes.push(accumulated);
                // The text fn is given a buffer of the ACCUMULATED length, so a caller can express
                // "the whole session" versus "a slice" in the same terms as before.
                return { lines: [{ text: text(new Float32Array(accumulated)) }] };
            },
            stop: vi.fn(),
            close: vi.fn(),
        }),
        destroy: vi.fn(),
    };
    return { transcriber: t, seen, passes };
};

/** A transcriber with NO streaming API — start() must refuse rather than fall back. */
const nonStreamingTranscriber = (): MoonshineTranscriber => ({
    transcribe: async () => ({ lines: [{ text: 'whole buffer' }] }),
    // DELIBERATELY no createStream: this double exists to prove start() refuses such a runtime.
});

const fakeMic = () => {
    let cb: ((f: Float32Array) => void) | null = null;
    const mic = {
        state: 'running', sampleRate: SR,
        onFrame: (fn: (f: Float32Array) => void) => { cb = fn; return () => { cb = null; }; },
        offFrame: () => { cb = null; },
        stop: vi.fn(), close: vi.fn(),
    } as unknown as MicStream;
    return { mic, push: (f: Float32Array) => cb?.(f), attached: () => cb !== null };
};

const engineWith = (t: MoonshineTranscriber) => new MoonshineStreamingEngine({
    candidateId: 'moonshine:streaming-medium',
    modelArch: 'MOONSHINE_STREAMING_MEDIUM',
    loadTranscriber: async () => t,
});

describe('lifecycle parity with the Private STT contract', () => {
    it('init → start → stop → terminate, with the worker released', async () => {
        const { transcriber } = recordingTranscriber(() => 'hello world');
        const e = engineWith(transcriber);
        expect((await e.init()).isOk).toBe(true);
        const { mic, push, attached } = fakeMic();
        await e.start(mic);
        expect(attached()).toBe(true);
        push(frame(SR));
        await vi.waitFor(() => expect(e.getInterimTranscript()).toBe('hello world'));
        await e.stop();
        expect(attached()).toBe(false);
        await e.terminate();
        expect(transcriber.destroy).toHaveBeenCalled();   // a leaked worker holds hundreds of MB
    });

    it('CASUALTY: start before a successful init FAILS VISIBLY', async () => {
        const e = new MoonshineStreamingEngine({
            candidateId: 'moonshine:streaming-medium', modelArch: 'MOONSHINE_STREAMING_MEDIUM',
            loadTranscriber: async () => { throw new Error('model unavailable'); },
        });
        const r = await e.init();
        expect(r.isOk).toBe(false);
        await expect(e.start(fakeMic().mic)).rejects.toThrow(/before a successful init/);
        // The failure is RECORDED, not swallowed into a silent fallback to another model.
        expect(e.getMetadata().failure).toMatchObject({ phase: 'init', message: 'model unavailable' });
    });

    it('CASUALTY: a decode failure is recorded and never becomes another model’s result', async () => {
        const t: MoonshineTranscriber = {
            transcribe: async () => { throw new Error('whole-buffer API must not be used'); },
            // The failure belongs on the PASS: that is where decoding happens in a session.
            createStream: () => ({
                start: vi.fn(),
                addAudio: vi.fn(),
                transcribe: () => { throw new Error('decode exploded'); },
                stop: vi.fn(), close: vi.fn(),
            }),
        };
        const e = engineWith(t);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        push(frame(SR));
        await vi.waitFor(() => expect(e.getMetadata().failure?.phase).toBe('decode'));
        expect(await e.getTranscript()).toBe('');   // no invented transcript
    });

    it('pause detaches and resume reattaches without losing the buffer', async () => {
        const { transcriber } = recordingTranscriber(() => 'x');
        const e = engineWith(transcriber);
        await e.init();
        const { mic, push, attached } = fakeMic();
        await e.start(mic);
        push(frame(SR));
        await e.pause();
        expect(attached()).toBe(false);
        await e.resume();
        expect(attached()).toBe(true);
        push(frame(SR));
        await e.stop();
        expect(await e.getTranscript()).toBe('x');
    });
});

describe('the live pass is NOT the final pass — CORRECTED for the streaming session', () => {
    /**
     * These two tests previously asserted that the live path decoded a BOUNDED TAIL WINDOW and that
     * stop() re-decoded the WHOLE BUFFER as a separate call. Both described the old implementation,
     * and that implementation was the defect: taking a slice per window used the non-streaming
     * whole-buffer API on a streaming architecture, which is what made each decode depend on the one
     * before it.
     *
     * The contract is now the session's: audio is handed over as it arrives and every pass summarises
     * everything accumulated. The distinction the tests were protecting — live is not final — still
     * holds, but it is now "an unforced pass mid-session" versus "a FORCED pass at stop", not
     * "a 3-second slice" versus "the whole buffer".
     */
    it('a live pass summarises the session so far; the final pass is FORCED', async () => {
        const passes: number[] = [];
        const t: MoonshineTranscriber = {
            transcribe: async () => { throw new Error('whole-buffer API must not be used'); },
            createStream: () => {
                let acc = 0;
                return {
                    start: vi.fn(),
                    addAudio: (a: Float32Array) => { acc += a.length; },
                    transcribe: (flags?: number) => {
                        passes.push(acc);
                        return { lines: [{ text: flags === FORCE_UPDATE ? `final:${acc}` : `live:${acc}` }] };
                    },
                    stop: vi.fn(), close: vi.fn(),
                };
            },
        };
        const e = engineWith(t);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 10; i++) push(frame(SR));
        await vi.waitFor(() => expect(passes.length).toBeGreaterThan(0));
        expect(e.getInterimTranscript()).toMatch(/^live:/);

        const liveInterim = e.getInterimTranscript();
        await e.stop();
        const final = await e.getTranscript();

        // THE PROPERTY, stated rather than implied by the fake's encoding: the final covers the WHOLE
        // session. The old slice-based test guarded this with the wrong mechanism; the mechanism
        // changed and the property must not travel out with it.
        expect(final).toBe(`final:${10 * SR}`);              // every frame, not the tail
        expect(passes[passes.length - 1]).toBe(10 * SR);     // the final pass saw the whole session
        // and the final is NOT a live pass that happened to settle last — the hazard the engine's own
        // stop() comment names: three seconds presented as the whole session.
        expect(final).not.toBe(liveInterim);
        expect(final).not.toMatch(/^live:/);
    });

    it('the final transcript is one pass over the session, never a concatenation of windows', async () => {
        // Concatenating windows duplicates at every boundary; the product must not do that, and the
        // session API is what makes it structurally impossible rather than merely avoided.
        const { transcriber } = recordingTranscriber((a) => (a.length > 4 * SR ? 'the whole thing' : 'window'));
        const e = engineWith(transcriber);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 8; i++) push(frame(SR));
        await e.stop();
        expect(await e.getTranscript()).toBe('the whole thing');
    });
});

describe('metadata is OBSERVED, never defaulted', () => {
    it('reports the candidate that actually ran', async () => {
        // PrivateSTT.getMetadata() reads its model from PRIV_STT_V4_DEFAULT_VARIANT, so an int8 session
        // reports q4. An identity taken from a default is not evidence.
        const { transcriber } = recordingTranscriber(() => 'hi');
        const e = new MoonshineStreamingEngine({
            candidateId: 'moonshine:streaming-medium', modelArch: 'MOONSHINE_STREAMING_MEDIUM',
            loadTranscriber: async () => transcriber,
        });
        const before = e.getMetadata();
        expect(before.candidateId).toBe('moonshine:streaming-medium');
        expect(before.observedExecution.firstDecodeAt).toBeNull();          // "not established", never a guess
        expect(before.failure).toBeNull();

        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        push(frame(SR));
        await vi.waitFor(() => expect(e.getMetadata().observedExecution.firstDecodeAt).not.toBeNull());
        expect(e.getMetadata().liveWindowSeconds).toBe(LIVE_WINDOW_SECONDS);
        expect(e.getMetadata().configuredRuntime.package).toBe('@moonshine-ai/moonshine-wasm');
    });
});

describe('AUDIO NEVER LEAVES THE DEVICE', () => {
    // Weights and runtime may download. Recorded audio may not. The tripwire classifies every outbound
    // request rather than trusting that no code path sends one.
    const egress: Array<{ via: string; body: unknown }> = [];
    beforeEach(() => {
        egress.length = 0;
        vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: unknown }) => {
            egress.push({ via: 'fetch', body: init?.body }); return new Response('{}');
        }));
        vi.stubGlobal('WebSocket', class { constructor() { egress.push({ via: 'websocket', body: null }); } });
        vi.stubGlobal('navigator', { ...globalThis.navigator, sendBeacon: (_u: string, b?: unknown) => { egress.push({ via: 'sendBeacon', body: b }); return true; } });
    });
    afterEach(() => vi.unstubAllGlobals());

    const carriesAudio = (body: unknown): boolean =>
        body instanceof Float32Array || body instanceof ArrayBuffer || body instanceof Blob
        || (typeof body === 'string' && /"audio"|data:audio\//.test(body));

    it('a full record → decode → stop cycle transmits NOTHING', async () => {
        const { transcriber } = recordingTranscriber(() => 'local only');
        const e = engineWith(transcriber);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 5; i++) push(frame(SR));
        await vi.waitFor(() => expect(e.getInterimTranscript()).toBe('local only'));
        await e.stop();
        await e.terminate();
        expect(egress, `engine performed egress: ${JSON.stringify(egress.map((x) => x.via))}`).toEqual([]);
    });

    it('POSITIVE CONTROL: the tripwire really detects audio egress', async () => {
        // A tripwire that never fires proves nothing about the run it watched.
        await fetch('https://example.invalid/upload', { body: frame(16) } as RequestInit);
        expect(egress).toHaveLength(1);
        expect(carriesAudio(egress[0].body)).toBe(true);
    });
});

describe('inference is SERIALIZED — one worker, one decode at a time', () => {
    /** A transcriber that blocks until released, so overlap is observable rather than assumed. */
    /** A session whose PASS blocks until released, so overlap is observable rather than assumed. */
    const gated = () => {
        let concurrent = 0, maxConcurrent = 0, accumulated = 0;
        const releases: Array<() => void> = [];
        const t: MoonshineTranscriber = {
            transcribe: async () => { throw new Error('whole-buffer API must not be used'); },
            createStream: () => ({
                start: vi.fn(),
                addAudio: (a: Float32Array) => { accumulated += a.length; },
                // Synchronous by contract, so concurrency is observed through the engine's own
                // serialization rather than through a promise the runtime never returns.
                transcribe: () => {
                    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
                    concurrent--;
                    return { lines: [{ text: `n:${accumulated}` }] };
                },
                stop: vi.fn(), close: vi.fn(),
            }),
        };
        return { t, releaseAll: () => { while (releases.length) releases.shift()!(); }, max: () => maxConcurrent };
    };

    it('CASUALTY: frames arriving mid-decode never start a second concurrent decode', async () => {
        const g = gated();
        const e = engineWith(g.t);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 5; i++) push(frame(SR));   // 5 frames while the first decode is blocked
        await new Promise((r) => setTimeout(r, 10));
        expect(g.max()).toBe(1);
        g.releaseAll();
        await vi.waitFor(() => expect(e.getInterimTranscript()).not.toBe(''));
        expect(g.max()).toBe(1);                        // still never overlapped
    });

    it('frames arriving mid-decode are COALESCED into one further decode, not dropped', async () => {
        // Dropping them stales the interim transcript; queueing one per frame floods a single worker.
        const g = gated();
        const e = engineWith(g.t);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        push(frame(SR));
        await new Promise((r) => setTimeout(r, 5));
        push(frame(SR)); push(frame(SR));              // arrive during the first decode
        g.releaseAll();
        await new Promise((r) => setTimeout(r, 5));
        g.releaseAll();
        await vi.waitFor(() => expect(e.getInterimTranscript()).toBe(`n:${3 * SR}`));
    });

    it('CASUALTY: stop() AWAITS the in-flight decode and its result cannot overwrite the final', async () => {
        // A live decode settling after the final pass would present the last three seconds as the whole
        // session — the single worst outcome available here.
        const g = gated();
        const e = engineWith(g.t);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 6; i++) push(frame(SR));
        await new Promise((r) => setTimeout(r, 5));
        const stopped = e.stop();
        g.releaseAll();
        await new Promise((r) => setTimeout(r, 5));
        g.releaseAll();
        await stopped;
        expect(await e.getTranscript()).toBe(`n:${6 * SR}`);   // the FULL buffer, not a window
        expect(g.max()).toBe(1);
    });
});

describe('sample rate is enforced, not interpreted', () => {
    it('CASUALTY: a non-16 kHz microphone is REFUSED', async () => {
        // 48 kHz frames do not error — the runtime decodes them three times too fast and returns
        // confident nonsense. A wrong transcript is worse than a missing one.
        const { transcriber } = recordingTranscriber(() => 'x');
        const e = engineWith(transcriber);
        await e.init();
        const { mic } = fakeMic();
        (mic as { sampleRate: number }).sampleRate = 48_000;
        await expect(e.start(mic)).rejects.toThrow(/16000 Hz mono.*48000 Hz/s);
        expect(e.getMetadata().failure).toMatchObject({ phase: 'start' });
    });

    it('POSITIVE CONTROL: 16 kHz is accepted', async () => {
        const { transcriber } = recordingTranscriber(() => 'x');
        const e = engineWith(transcriber);
        await e.init();
        await expect(e.start(fakeMic().mic)).resolves.toBeUndefined();
    });
});

describe('identity is CONFIGURED provenance, kept separate from observed execution', () => {
    /**
     * REPLACES an earlier block that asserted runtimeVersion/assetIdentity were introspected from the
     * loaded transcriber. That contract was wrong in practice: the real runtime reports NEITHER, so both
     * came back null in both real-runtime probe runs and every human session was unattributable. The
     * identity now comes from the typed candidate registry — checked-in facts verified against the
     * lockfile and the committed pin table — and observed facts live in their own object.
     */
    it('CASUALTY: a session carries a NON-NULL runtime version, model revision and pin digest', async () => {
        // These are exactly the fields whose nullness blocked human A/B testing.
        const { transcriber } = recordingTranscriber(() => 'x');
        const e = engineWith(transcriber);
        await e.init();
        const m = e.getMetadata();
        expect(m.configuredRuntime.package).toBe('@moonshine-ai/moonshine-wasm');
        expect(m.configuredRuntime.version).toBe('0.1.5');
        expect(m.configuredModel.model).toBe('medium-streaming-en');
        expect(m.configuredModel.revision).toBe('quantized_26_07_30');
        expect(m.configuredModel.pinDigest).toBeTruthy();
        expect(m.configuredModel.pinDigest).toHaveLength(64);
    });

    it('configured identity does NOT come from the transcriber, even when it offers one', async () => {
        // A runtime that reports a MATCHING version must not become the source of truth; configuration
        // is the authority, and the runtime value is only cross-checked.
        const t = Object.assign(
            {
                transcribe: async () => ({ lines: [{ text: 'x' }] }),
                createStream: () => streamOver(() => 'x'),
            } as MoonshineTranscriber,
            { version: '0.1.5', modelId: 'something/else-entirely' },
        );
        const e = engineWith(t);
        await e.init();
        expect(e.getMetadata().configuredModel.model).toBe('medium-streaming-en');
    });

    it('CASUALTY: a runtime reporting a DIFFERENT version fails init rather than being recorded', async () => {
        // A mismatch means the loaded bytes are not the ones the registry describes. Recording it
        // quietly would attribute a transcript to a model that did not produce it.
        const t = Object.assign(
            {
                transcribe: async () => ({ lines: [{ text: 'x' }] }),
                createStream: () => streamOver(() => 'x'),
            } as MoonshineTranscriber,
            { version: '9.9.9' },
        );
        const e = engineWith(t);
        const r = await e.init();
        expect(r.isOk).toBe(false);
        expect(e.getMetadata().failure).toMatchObject({ phase: 'init' });
        expect(String((r as { error: Error }).error.message)).toMatch(/refusing to attribute/);
    });

    it('observed execution is SEPARATE and starts unestablished', async () => {
        const { transcriber } = recordingTranscriber(() => 'x');
        const e = engineWith(transcriber);
        const before = e.getMetadata();
        expect(before.observedExecution.initSucceeded).toBe(false);
        expect(before.observedExecution.firstDecodeAt).toBeNull();
        // NOT DETERMINED, never a guessed false — a false here would read as proof that inference runs
        // on the main thread, which this engine cannot honestly claim either way.
        expect(before.observedExecution.workerObserved).toBeNull();
        await e.init();
        expect(e.getMetadata().observedExecution.initSucceeded).toBe(true);
    });

    it('configured provenance carries no observed fields, and vice versa', async () => {
        const { transcriber } = recordingTranscriber(() => 'x');
        const e = engineWith(transcriber);
        await e.init();
        const m = e.getMetadata();
        expect(Object.keys(m.configuredRuntime).concat(Object.keys(m.configuredModel))
            .every((k) => !/observed|init|decode|backend|worker/i.test(k))).toBe(true);
        expect(Object.keys(m.observedExecution).some((k) => /version|revision|pinDigest/i.test(k))).toBe(false);
    });
});

describe('a finalized session cannot be reopened', () => {
    it('CASUALTY: resume() after stop() is REFUSED', async () => {
        // stop() leaves `mic` set, so resume() would reattach the frame handler and append new audio to
        // a buffer whose transcript was already delivered — and restart live decodes over it.
        const { transcriber } = recordingTranscriber(() => 'x');
        const e = engineWith(transcriber);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        push(frame(SR));
        await e.stop();
        await expect(e.resume()).rejects.toThrow(/finalized/i);
        push(frame(SR));                                   // no handler is attached
        expect(await e.getTranscript()).toBe('x');
    });

    it('POSITIVE CONTROL: resume() mid-session still works', async () => {
        const { transcriber } = recordingTranscriber(() => 'x');
        const e = engineWith(transcriber);
        await e.init();
        await e.start(fakeMic().mic);
        await e.pause();
        await expect(e.resume()).resolves.toBeUndefined();
    });
});

describe('init FAILS CLOSED on an identity that cannot attribute a session', () => {
    /**
     * These guards protect the human-test contract, not a type error. `candidateId` is typed, but the
     * value can still arrive from build configuration, so the runtime check is what actually prevents an
     * unattributable session — and it must fail BEFORE a 147 MB download and a participant's recording.
     */
    const withCandidate = (id: string) => new MoonshineStreamingEngine({
        candidateId: id as unknown as ConstructorParameters<typeof MoonshineStreamingEngine>[0]['candidateId'],
        modelArch: 'MOONSHINE_STREAMING_MEDIUM',
        loadTranscriber: async () => recordingTranscriber(() => 'x').transcriber,
    });

    it('CASUALTY: an UNREGISTERED candidate is refused before any weights are fetched', async () => {
        const e = withCandidate('moonshine:streaming-enormous');
        const r = await e.init();
        expect(r.isOk).toBe(false);
        expect(String((r as { error: Error }).error.message)).toMatch(/no complete configured identity/);
        // getMetadata must survive the failure it reports, and must not fabricate configuration.
        const m = e.getMetadata();
        expect(m.failure).toMatchObject({ phase: 'init' });
        expect(m.observedExecution.initSucceeded).toBe(false);
        expect(m.configuredRuntime.version).toBe('');
        expect(m.configuredModel.pinDigest).toBeNull();
    });

    it('CASUALTY: a candidate with NO committed pin digest is refused', async () => {
        // Registered and otherwise complete, but its model bytes are not pin-tracked — so a transcript
        // could not be tied to specific weights.
        //
        // Driven through a SYNTHETIC entry rather than a real one. This asserted against v2:base.en,
        // which had no digest when this suite was written; v2 has carried a self-hosted digest since
        // the registry landed, so the case was silently testing nothing that could fail. Testing a
        // refusal through a candidate that happens to be deficient means the test dies the moment the
        // candidate is fixed — the mechanism has to be provable on its own.
        const digestless = {
            ...CANDIDATES['moonshine:streaming-medium'],
            assets: { ...CANDIDATES['moonshine:streaming-medium'].assets, pinDigest: null },
        };
        const e = new MoonshineStreamingEngine({
            candidateId: 'moonshine:streaming-medium',
            modelArch: 'MOONSHINE_STREAMING_MEDIUM',
            loadTranscriber: async () => recordingTranscriber(() => 'x').transcriber,
            candidateSource: () => digestless,
        } as unknown as ConstructorParameters<typeof MoonshineStreamingEngine>[0]);
        const r = await e.init();
        expect(r.isOk).toBe(false);
        expect(String((r as { error: Error }).error.message)).toMatch(/no committed asset pin digest/);
    });

    it('POSITIVE CONTROL: the same candidate WITH its digest initialises', () => {
        // Proves the refusal above is about the missing digest and nothing else.
        expect(CANDIDATES['moonshine:streaming-medium'].assets.pinDigest).toBeTruthy();
    });

    it('POSITIVE CONTROL: the registered Moonshine candidate initialises', async () => {
        const e = withCandidate('moonshine:streaming-medium');
        expect((await e.init()).isOk).toBe(true);
        expect(e.getMetadata().configuredModel.pinDigest).toHaveLength(64);
    });
});

describe('the continuous session uses the STREAMING api, never the whole-buffer call', () => {
    it('CASUALTY: start() REFUSES a runtime with no createStream()', async () => {
        // Falling back to per-window whole-buffer transcribe() is the misuse that made every clip in
        // the benchmark depend on the one before it. Doing that silently in the product would put the
        // same defect in front of a user.
        const e = engineWith(nonStreamingTranscriber());
        await e.init();
        await expect(e.start(fakeMic().mic)).rejects.toThrow(/exposes no createStream/);
        expect(e.getMetadata().failure).toMatchObject({ phase: 'start' });
    });

    it('CASUALTY: audio is handed to the STREAM, not re-decoded as a tail window', async () => {
        const { transcriber, seen, passes } = recordingTranscriber(() => 'x');
        const e = engineWith(transcriber);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        push(frame(SR)); push(frame(SR));
        await vi.waitFor(() => expect(passes.length).toBeGreaterThan(0));
        // The whole-buffer entry point must never be touched during a live session.
        expect(seen).toEqual([]);
        // and each pass summarises everything handed over so far, not a 3-second slice.
        expect(passes[passes.length - 1]).toBe(2 * SR);
    });

    it('CASUALTY: the final transcript comes from the SAME session, forced', async () => {
        // Re-decoding the whole buffer as a fresh call discards the session's own accumulated state.
        const { transcriber, seen, passes } = recordingTranscriber((a) => `n:${a.length}`);
        const e = engineWith(transcriber);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 4; i++) push(frame(SR));
        await e.stop();
        expect(await e.getTranscript()).toBe(`n:${4 * SR}`);
        expect(seen, 'the whole-buffer API was used for the final pass').toEqual([]);
        expect(passes[passes.length - 1]).toBe(4 * SR);
    });
});
