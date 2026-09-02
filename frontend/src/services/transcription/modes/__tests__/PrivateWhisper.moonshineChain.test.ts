// @vitest-environment jsdom
/**
 * #1405 — the real chain, with a real Moonshine engine under a real PrivateWhisper.
 *
 * SCOPE, MEASURED NOT ASSUMED. In this harness the whole-utterance COMMIT does not execute: the
 * transcript comes back empty and the single forced pass observed here originates from the `stop()`
 * delegation, not from `commitWholeUtteranceTranscript`. Mutating the commit's finality, replaying the
 * buffer at finalization, or opening a stream per window therefore do NOT turn these tests red — the
 * mutated code is never reached.
 *
 * What this file does prove, and what killed a real mutant: both PrivateWhisper and the engine attach
 * listeners to the same mic, and each frame still reaches `stream.addAudio` exactly ONCE; one session
 * stream serves the whole take; no live window forces a pass; and the session is closed on stop even
 * when the commit throws.
 *
 * The commit's finality is covered separately, behaviourally, in `PrivateWhisper.test.ts`, where a
 * mocked PrivateSTT lets the commit run and removing `final: true` turns that suite red. Neither file
 * alone is sufficient; the pair is what covers the path.
 *
 * Only the vendor transcriber is doubled. Everything between the recording loop and
 * `stream.addAudio` is production code, which is what makes duplicate-audio observable: both
 * PrivateWhisper and the engine attach listeners to the same mic, and if the periodic decode also
 * replayed its buffer, every frame would reach the model twice and the transcript would gain a
 * duplicated passage that reads as a model defect.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import PrivateWhisper from '../PrivateWhisper';
import { MoonshineStreamingEngine, type MoonshineStream, type MoonshineTranscriber } from '../../engines/MoonshineStreamingEngine';
import type { IPrivateSTT } from '../../../../contracts/IPrivateSTT';
import type { MicStream } from '../../utils/types';
import { PRIV_CLOUD_AUDIO, PRIV_STT, PRIV_STT_DERIVED } from '../../sttConstants';

vi.mock('../../../../lib/logger', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// The real VAD gates PrivateWhisper's buffering, and a synthetic constant-amplitude frame is not speech
// to it -- which is why the commit never ran and the transcript came back empty. `PrivateWhisper.test.ts`
// mocks this for the same reason. The gate is not what is under test here; frame routing is.
vi.mock('../../audio/pauseDetector', () => ({
    PauseDetector: vi.fn().mockImplementation(() => ({
        isMeaningfullySilent: vi.fn().mockReturnValue(false),
        processAudioFrame: vi.fn(),
        getCurrentSilenceDurationSeconds: vi.fn().mockReturnValue(0),
    })),
}));

/** Counts what the model actually receives: frames added, streams opened, forced passes run. */
function instrumentedRuntime() {
    const stats = { streamsOpened: 0, framesAdded: 0, samplesAdded: 0, forcedPasses: 0, closed: 0 };
    const transcriber: MoonshineTranscriber = {
        transcribe: () => { throw new Error('the non-streaming API must not be used in a session'); },
        close: vi.fn(() => { stats.closed += 1; }),
        createStream: (): MoonshineStream => {
            stats.streamsOpened += 1;
            return {
                start: vi.fn(),
                addAudio: (audio: Float32Array) => { stats.framesAdded += 1; stats.samplesAdded += audio.length; },
                transcribe: (flags?: number) => {
                    if (flags) stats.forcedPasses += 1;
                    return { lines: [{ text: `heard:${stats.samplesAdded}` }] };
                },
                stop: vi.fn(), close: vi.fn(),
            };
        },
    };
    return { transcriber, stats };
}

/** The production facade surface PrivateWhisper uses, over a REAL Moonshine engine. */
function chainFacade(transcriber: MoonshineTranscriber, over: Partial<IPrivateSTT> = {}) {
    const engine = new MoonshineStreamingEngine({
        candidateId: 'moonshine:streaming-medium',
        modelArch: 'MOONSHINE_STREAMING_MEDIUM',
        loadTranscriber: async () => transcriber,
    });
    const starts: Array<MicStream | undefined> = [];
    const stops: number[] = [];
    const facade = {
        checkAvailability: async () => ({ isAvailable: true }),
        init: async () => { await engine.init(); return { isOk: true as const, data: undefined }; },
        start: async (mic?: MicStream) => { starts.push(mic); await engine.start(mic as never); },
        stop: async () => { stops.push(Date.now()); await engine.stop(); },
        transcribe: (audio: Float32Array, options?: { final?: boolean }) => engine.transcribe(audio, options),
        destroy: async () => { await engine.terminate(); },
        getEngineType: () => 'moonshine-streaming',
        getMetadata: () => ({ engineVersion: 'private_moonshine:medium-streaming-en', modelName: 'medium-streaming-en', deviceType: 'browser' }),
        getLastHeartbeatTimestamp: () => Date.now(),
        ...over,
    } as unknown as IPrivateSTT;
    return { facade, starts, stops, engine };
}

const makeMic = () => {
    const listeners: Array<(f: Float32Array) => void> = [];
    const mic = {
        state: 'ready',
        sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
        // TWO LEGITIMATE SUBSCRIBERS: Moonshine for its continuous stream, PrivateWhisper for buffering
        // and orchestration. The disposer removes the EXACT listener it registered -- returning a no-op
        // would let a disposed listener keep receiving frames and quietly double-count.
        onFrame: (cb: (f: Float32Array) => void) => {
            listeners.push(cb);
            return () => {
                const at = listeners.indexOf(cb);
                if (at >= 0) listeners.splice(at, 1);
            };
        },
        offFrame: vi.fn(), stop: vi.fn(), close: vi.fn(),
        _mediaStream: new MediaStream(),
    } as unknown as MicStream;
    return { mic, listeners, speak: (f: Float32Array) => listeners.forEach((l) => l(f)) };
};

const frame = () => new Float32Array(PRIV_STT_DERIVED.MIN_TRANSCRIPTION_SAMPLES).fill(0.5);

describe('every frame reaches the model exactly once', () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it('CASUALTY: one stream receives every live window, and no frame is added twice', async () => {
        vi.useFakeTimers();
        const { transcriber, stats } = instrumentedRuntime();
        const { facade } = chainFacade(transcriber);
        const whisper = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() } as never, facade);

        await whisper.init();
        const { mic, speak } = makeMic();
        await whisper.start(mic);

        const WINDOWS = 3;
        for (let i = 0; i < WINDOWS; i++) {
            speak(frame());
            await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);
        }

        // Both PrivateWhisper and the engine observe the mic, but only the engine feeds the model.
        expect(stats.framesAdded, 'each frame must reach addAudio exactly once').toBe(WINDOWS);
        expect(stats.samplesAdded).toBe(WINDOWS * frame().length);
        // A live decode must not open a second stream, and must not replay the buffer.
        expect(stats.streamsOpened, 'one session stream for the whole take').toBe(1);
        expect(stats.forcedPasses, 'no live window may force a final pass').toBe(0);

        await whisper.stop();
        expect(stats.framesAdded, 'finalization must not re-add the buffered utterance').toBe(WINDOWS);
        expect(stats.streamsOpened, 'the final pass uses the ORIGINAL stream').toBe(1);
        expect(stats.forcedPasses, 'exactly one forced final pass').toBe(1);
    });

    it('CASUALTY: repeated Stop performs no second forced pass', async () => {
        vi.useFakeTimers();
        const { transcriber, stats } = instrumentedRuntime();
        const { facade, stops } = chainFacade(transcriber);
        const whisper = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() } as never, facade);
        await whisper.init();
        const { mic, speak } = makeMic();
        await whisper.start(mic);
        speak(frame());
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        await whisper.stop();
        const after = stats.forcedPasses;
        await whisper.stop();
        expect(stats.forcedPasses).toBe(after);
        expect(stops.length, 'the engine session is closed on stop').toBeGreaterThanOrEqual(1);
    });

    it('CASUALTY: a COMMIT FAILURE still closes the engine session', async () => {
        vi.useFakeTimers();
        const { transcriber } = instrumentedRuntime();
        const { facade, stops } = chainFacade(transcriber, {
            transcribe: (async (_a: Float32Array, o?: { final?: boolean }) => {
                if (o?.final) throw new Error('commit exploded');
                return { isOk: true, data: '' };
            }) as never,
        });
        const whisper = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() } as never, facade);
        await whisper.init();
        const { mic, speak } = makeMic();
        await whisper.start(mic);
        speak(frame());
        await vi.advanceTimersByTimeAsync(PRIV_STT.PROCESSING_INTERVAL_MS);

        await whisper.stop().catch(() => { /* the failure surfaces; the session must still close */ });
        expect(stops.length, 'a stream must not be left open when the commit throws').toBeGreaterThanOrEqual(1);
    });

    it('CASUALTY: if engine start FAILS, recording does not begin', async () => {
        const { transcriber } = instrumentedRuntime();
        const { facade } = chainFacade(transcriber, {
            start: (async () => { throw new Error('engine start failed'); }) as never,
        });
        const whisper = new PrivateWhisper({ onTranscriptUpdate: vi.fn(), onReady: vi.fn() } as never, facade);
        await whisper.init();
        const { mic } = makeMic();

        await expect(whisper.start(mic), 'a failed engine start must not silently record').rejects.toThrow();
    });
});
