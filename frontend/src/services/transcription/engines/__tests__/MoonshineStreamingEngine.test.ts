import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
    MoonshineStreamingEngine, LIVE_WINDOW_SECONDS, type MoonshineTranscriber,
} from '../MoonshineStreamingEngine';
import type { MicStream } from '../../utils/types';

/**
 * #1263 — Moonshine as a PRODUCT engine.
 *
 * The frozen 600 validates FULL-UTTERANCE accuracy. The product's live path decodes a recent 3-second
 * window and only the final pass sees the whole buffer, so the benchmark cannot speak to interim
 * behaviour at all. These tests exercise the lifecycle and the window contract with an injected
 * transcriber — no 318 MB download, and every decode observable.
 */
const SR = 16_000;
const frame = (n: number, v = 0.1) => Float32Array.from({ length: n }, () => v);

/** Records exactly what audio each decode saw, so window behaviour is measured rather than assumed. */
const recordingTranscriber = (text: (audio: Float32Array) => string) => {
    const seen: number[] = [];
    const t: MoonshineTranscriber = {
        transcribe: async (audio) => { seen.push(audio.length); return { lines: [{ text: text(audio) }] }; },
        destroy: vi.fn(),
    };
    return { transcriber: t, seen };
};

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
    candidateId: 'moonshine_streaming_medium',
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
            candidateId: 'moonshine_streaming_medium', modelArch: 'MOONSHINE_STREAMING_MEDIUM',
            loadTranscriber: async () => { throw new Error('model unavailable'); },
        });
        const r = await e.init();
        expect(r.isOk).toBe(false);
        await expect(e.start(fakeMic().mic)).rejects.toThrow(/before a successful init/);
        // The failure is RECORDED, not swallowed into a silent fallback to another model.
        expect(e.getMetadata().failure).toMatchObject({ phase: 'init', message: 'model unavailable' });
    });

    it('CASUALTY: a decode failure is recorded and never becomes another model’s result', async () => {
        const t: MoonshineTranscriber = { transcribe: async () => { throw new Error('decode exploded'); } };
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

describe('the 3-second live window is NOT the final full-buffer pass', () => {
    it('live decodes a BOUNDED recent window; stop decodes EVERYTHING', async () => {
        // This is the distinction the frozen 600 cannot test: it only ever measures the final pass.
        const { transcriber, seen } = recordingTranscriber((a) => `len:${a.length}`);
        const e = engineWith(transcriber);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 10; i++) push(frame(SR));       // 10 seconds of audio
        await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));

        const liveMax = Math.max(...seen);
        expect(liveMax).toBeLessThanOrEqual(LIVE_WINDOW_SECONDS * SR);   // bounded window

        await e.stop();
        expect(Math.max(...seen)).toBe(10 * SR);                          // full buffer at stop
        expect(await e.getTranscript()).toBe(`len:${10 * SR}`);
    });

    it('the final transcript is the full-buffer decode, not a concatenation of windows', async () => {
        // Concatenating windows duplicates at every boundary; the product must not do that.
        const { transcriber } = recordingTranscriber((a) => (a.length > 4 * SR ? 'the whole thing' : 'window'));
        const e = engineWith(transcriber);
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 8; i++) push(frame(SR));
        await vi.waitFor(() => expect(e.getInterimTranscript()).toBe('window'));
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
            candidateId: 'moonshine_streaming_medium', modelArch: 'MOONSHINE_STREAMING_MEDIUM',
            loadTranscriber: async () => transcriber,
        });
        const before = e.getMetadata();
        expect(before.candidateId).toBe('moonshine_streaming_medium');
        expect(before.firstDecodeAt).toBeNull();          // "not established", never a guess
        expect(before.failure).toBeNull();

        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        push(frame(SR));
        await vi.waitFor(() => expect(e.getMetadata().firstDecodeAt).not.toBeNull());
        expect(e.getMetadata().liveWindowSeconds).toBe(LIVE_WINDOW_SECONDS);
        expect(e.getMetadata().runtime).toBe('@moonshine-ai/moonshine-wasm');
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
