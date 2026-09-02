/**
 * #1402 P1 #1 and #5 — the decode path a REAL recording takes, and isolation between recordings.
 *
 * Every earlier proof stopped at initialisation or drove the streaming pass directly. None used
 * `PrivateSTT.transcribe(audio)` — the method `PrivateWhisper` actually calls to commit an utterance —
 * and the engine did not implement it. `validateEngine` requires only init/start/stop, so the engine
 * passed construction and every init test and would have thrown "not a function" at the first real
 * commit decode, which a user experiences as a recording that silently produced nothing.
 *
 * The transcriber here is a double because a unit test cannot download 305 MB, but it implements the
 * REAL runtime surface — `createStream`, `addAudio`, `transcribe(flags)`, `stop`, `close` — and the audio
 * is carried all the way to that surface. Nothing between the facade and the runtime is stubbed.
 */
import { describe, expect, it, vi } from 'vitest';
import { MoonshineStreamingEngine, type MoonshineStream, type MoonshineTranscriber } from '../MoonshineStreamingEngine';

const SR = 16_000;
const speech = (seconds: number, seed = 1) => {
    const pcm = new Float32Array(SR * seconds);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / (40 + seed)) * 0.25;
    return pcm;
};

/** Records every sample the RUNTIME was given, so duplication and carry-over are observable. */
function recordingRuntime() {
    const streams: Array<{ received: number[]; closed: boolean; decodes: number }> = [];
    const transcriber: MoonshineTranscriber = {
        transcribe: () => { throw new Error('the non-streaming API must not be used on a streaming arch'); },
        close: vi.fn(() => {}),
        createStream: (): MoonshineStream => {
            const s = { received: [] as number[], closed: false, decodes: 0 };
            streams.push(s);
            return {
                start: vi.fn(),
                addAudio: (audio: Float32Array) => { s.received.push(audio.length); },
                transcribe: () => {
                    s.decodes += 1;
                    const total = s.received.reduce((a, b) => a + b, 0);
                    return { lines: [{ text: `decoded:${total}` }] };
                },
                stop: vi.fn(),
                close: vi.fn(() => { s.closed = true; }),
            };
        },
    };
    return { transcriber, streams };
}

const engineWith = (t: MoonshineTranscriber) => new MoonshineStreamingEngine({
    candidateId: 'moonshine:streaming-medium',
    modelArch: 'MOONSHINE_STREAMING_MEDIUM',
    loadTranscriber: async () => t,
});

describe('a real utterance reaches Moonshine decode through the facade method', () => {
    it('POSITIVE CONTROL: transcribe(audio) carries the audio to the runtime and returns its text', async () => {
        const { transcriber, streams } = recordingRuntime();
        const e = engineWith(transcriber);
        expect((await e.init()).isOk).toBe(true);

        const audio = speech(3);
        const result = await e.transcribe(audio);

        expect(result.isOk, 'the commit decode must succeed').toBe(true);
        expect(result.isOk && result.data).toBe(`decoded:${audio.length}`);
        // The bytes reached the RUNTIME, not a wrapper that answered on its behalf.
        const last = streams[streams.length - 1];
        expect(last.received).toEqual([audio.length]);
        expect(last.decodes).toBe(1);
    });

    it('CASUALTY: the non-streaming whole-buffer API is never used for a session decode', async () => {
        // `transcriber.transcribe()` throws in this double precisely so a fallback to it is a failure
        // rather than a passing test with the wrong machinery underneath.
        const { transcriber } = recordingRuntime();
        const e = engineWith(transcriber);
        await e.init();
        await expect(e.transcribe(speech(1))).resolves.toMatchObject({ isOk: true });
    });

    it('CASUALTY: a runtime with no streaming API is REFUSED, not silently downgraded', async () => {
        const e = engineWith({
            transcribe: () => ({ lines: [{ text: 'whole buffer' }] }),
            close: vi.fn(() => {}),
        } as MoonshineTranscriber);
        await e.init();
        const result = await e.transcribe(speech(1));
        expect(result.isOk).toBe(false);
        expect(e.getMetadata().failure).toMatchObject({ phase: 'decode' });
    });

    it('CASUALTY: decoding before init fails visibly instead of returning empty text', async () => {
        // An empty transcript is indistinguishable from a silent recording and would be scored against
        // the model rather than surfacing as the plumbing error it is.
        const { transcriber } = recordingRuntime();
        const e = engineWith(transcriber);
        const result = await e.transcribe(speech(1));
        expect(result.isOk).toBe(false);
        expect(result.isOk === false && result.error.message).toMatch(/before a successful init/);
    });

    it('CASUALTY: a decode failure is reported, never returned as an empty transcript', async () => {
        const transcriber: MoonshineTranscriber = {
            transcribe: () => ({ lines: [] }),
            close: vi.fn(() => {}),
            createStream: () => ({
                start: vi.fn(),
                addAudio: vi.fn(),
                transcribe: () => { throw new Error('decode exploded'); },
                stop: vi.fn(), close: vi.fn(),
            }),
        };
        const e = engineWith(transcriber);
        await e.init();
        const result = await e.transcribe(speech(1));
        expect(result.isOk).toBe(false);
        expect(e.getMetadata().failure).toMatchObject({ phase: 'decode', message: 'decode exploded' });
    });
});

describe('repeated recordings neither duplicate nor carry audio', () => {
    it('CASUALTY: the commit decode does not re-feed audio the session stream already holds', async () => {
        // The engine accumulates mic frames on the SESSION stream. If the commit decode pushed the same
        // utterance into that stream, the audio would be decoded twice and the transcript would gain a
        // duplicated passage — which reads as a model defect rather than a plumbing one.
        const { transcriber, streams } = recordingRuntime();
        const e = engineWith(transcriber);
        await e.init();

        const audio = speech(2);
        await e.transcribe(audio);
        await e.transcribe(audio);

        // Each commit used its OWN stream, and each stream saw the utterance exactly once.
        expect(streams).toHaveLength(2);
        for (const s of streams) expect(s.received).toEqual([audio.length]);
    });

    it('CASUALTY: every commit stream is closed, so none survives its decode', async () => {
        const { transcriber, streams } = recordingRuntime();
        const e = engineWith(transcriber);
        await e.init();
        await e.transcribe(speech(1));
        await e.transcribe(speech(1, 2));
        expect(streams.every((s) => s.closed), 'a stream left open holds runtime memory').toBe(true);
    });

    it('CASUALTY: audio from one recording cannot appear in the next', async () => {
        const { transcriber, streams } = recordingRuntime();
        const e = engineWith(transcriber);
        await e.init();

        const first = speech(4);
        const second = speech(1, 3);
        const a = await e.transcribe(first);
        const b = await e.transcribe(second);

        // The second decode's total is its own audio alone. Carried state would show up as the sum.
        expect(a.isOk && a.data).toBe(`decoded:${first.length}`);
        expect(b.isOk && b.data).toBe(`decoded:${second.length}`);
        expect(streams[1].received.reduce((x, y) => x + y, 0)).toBe(second.length);
    });

    it('CASUALTY: a failed decode does not leave its stream open for the next recording', async () => {
        let calls = 0;
        const closed: boolean[] = [];
        const transcriber: MoonshineTranscriber = {
            transcribe: () => ({ lines: [] }),
            close: vi.fn(() => {}),
            createStream: () => {
                const index = closed.push(false) - 1;
                return {
                    start: vi.fn(),
                    addAudio: vi.fn(),
                    transcribe: () => { calls += 1; if (calls === 1) throw new Error('first decode fails'); return { lines: [{ text: 'ok' }] }; },
                    stop: vi.fn(),
                    close: vi.fn(() => { closed[index] = true; }),
                };
            },
        };
        const e = engineWith(transcriber);
        await e.init();

        expect((await e.transcribe(speech(1))).isOk).toBe(false);
        expect(closed[0], 'the failed decode must still close its stream').toBe(true);
        expect((await e.transcribe(speech(1))).isOk, 'the next recording still works').toBe(true);
    });
});

describe('an engine that cannot decode is refused at construction', () => {
    it('CASUALTY: a Moonshine engine without transcribe() never reaches a recording', async () => {
        // The gap that hid the missing method: `validateEngine` requires init/start/stop only, because
        // it is also applied to the SERVICE, which drives recording differently and has no transcribe.
        // The engine-level check is therefore separate — and it must fire at construction, not mid-
        // session, because by then the user's audio is already gone.
        const { assertEngineCanDecode } = await import('../../../../contracts/STTEngine');
        expect(() => assertEngineCanDecode({ init: () => {}, start: () => {}, stop: () => {} }, 'moonshine-streaming'))
            .toThrow(/has no transcribe\(audio\) method/);
    });

    it('POSITIVE CONTROL: the real engine satisfies it', async () => {
        const { assertEngineCanDecode } = await import('../../../../contracts/STTEngine');
        const { transcriber } = recordingRuntime();
        expect(() => assertEngineCanDecode(engineWith(transcriber), 'moonshine-streaming')).not.toThrow();
    });
});
