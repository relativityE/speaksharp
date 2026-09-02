/**
 * #1402 forward-fix — two customer-facing STT defects found after merge.
 *
 * Both are the same shape as earlier findings in this workstream: a call that silently does nothing, and
 * a second inference whose result quietly replaces a better one.
 */
import { describe, expect, it, vi } from 'vitest';
import { MoonshineStreamingEngine, type MoonshineStream, type MoonshineTranscriber } from '../MoonshineStreamingEngine';

const SR = 16_000;
const audio = (secs: number) => new Float32Array(SR * secs).fill(0.1);

/** Counts inferences so a second decode of the same take is observable. */
function countingRuntime(sessionText: string, freshText: string) {
    const decodes = { session: 0, fresh: 0 };
    let sessionStreamMade = false;
    const transcriber: MoonshineTranscriber = {
        transcribe: () => { throw new Error('non-streaming API must not be used'); },
        close: vi.fn(() => {}),
        createStream: (): MoonshineStream => {
            const isSession = !sessionStreamMade;
            sessionStreamMade = true;
            return {
                start: vi.fn(),
                addAudio: vi.fn(),
                transcribe: () => {
                    if (isSession) { decodes.session += 1; return { lines: [{ text: sessionText }] }; }
                    decodes.fresh += 1;
                    return { lines: [{ text: freshText }] };
                },
                stop: vi.fn(), close: vi.fn(),
            };
        },
    };
    return { transcriber, decodes };
}

const engineWith = (t: MoonshineTranscriber) => new MoonshineStreamingEngine({
    candidateId: 'moonshine:streaming-medium',
    modelArch: 'MOONSHINE_STREAMING_MEDIUM',
    loadTranscriber: async () => t,
});

const fakeMic = () => ({ onFrame: () => () => {}, sampleRate: SR } as never);

describe('a finalized take is not decoded a second time', () => {
    it('CASUALTY: the commit decode does not run a second inference after stop', async () => {
        const { transcriber, decodes } = countingRuntime('the whole sentence I said', 'the whole sentence');
        const e = engineWith(transcriber);
        await e.init();
        await e.start(fakeMic());
        await e.stop();

        const before = decodes.fresh;
        const result = await e.transcribe(audio(3));

        expect(result.isOk).toBe(true);
        expect(decodes.fresh, 'a fresh stream decoded the same take again').toBe(before);
    });

    it('CASUALTY: trailing text committed by the session survives the commit call', async () => {
        // The second inference is the WEAKER one: a fresh stream has none of the session's accumulated
        // state, so words it had already committed can come back missing. The user sees the end of their
        // sentence disappear and reads it as the model dropping words.
        const { transcriber } = countingRuntime('I think that is basically it', 'I think that is');
        const e = engineWith(transcriber);
        await e.init();
        await e.start(fakeMic());
        await e.stop();

        const result = await e.transcribe(audio(3));
        expect(result.isOk && result.data).toBe('I think that is basically it');
        expect(result.isOk && result.data).not.toBe('I think that is');
    });

    it('CASUALTY: a finalized EMPTY transcript stays empty and runs no fresh inference', async () => {
        // The authority was `finalized && committed`, so a take that legitimately committed an empty
        // transcript — silence, a mis-start, a user who said nothing — fell through to a fresh decode
        // anyway. That is exactly where a second inference is most likely to invent something out of
        // noise, and the empty result was the honest one.
        const { transcriber, decodes } = countingRuntime('', 'hallucinated words from silence');
        const e = engineWith(transcriber);
        await e.init();
        await e.start(fakeMic());
        await e.stop();

        const before = decodes.fresh;
        const result = await e.transcribe(audio(3));

        expect(result.isOk).toBe(true);
        expect(result.isOk && result.data, 'silence must stay silent').toBe('');
        expect(decodes.fresh, 'no fresh stream may decode a finalized take').toBe(before);
    });

    it('POSITIVE CONTROL: before finalization, transcribe still performs a real decode', async () => {
        // The fix must not turn the facade decode into a no-op for takes that have not been stopped.
        // No session was started, so the first stream this creates IS the decode under test.
        const { transcriber, decodes } = countingRuntime('a real decode', 'a real decode');
        const e = engineWith(transcriber);
        await e.init();

        const result = await e.transcribe(audio(1));
        expect(result.isOk && result.data).toBe('a real decode');
        expect(decodes.session + decodes.fresh, 'the decode must actually run').toBe(1);
    });
});
