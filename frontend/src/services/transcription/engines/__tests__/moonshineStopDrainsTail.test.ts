import { describe, expect, it, vi } from 'vitest';
import { MoonshineStreamingEngine, type MoonshineTranscriber } from '../MoonshineStreamingEngine';

/**
 * #1263 — an immediate Stop keeps the last completed word.
 *
 * The real runtime only encodes a session's END when the stream is stopped: frames held back for lookahead are
 * released by the stop flush. On the pinned medium set a take that ended on "…over the lazy dog" with no pause
 * committed "…over the lazy" (2/2 runs), and kept "dog" only when 1.5 s of silence followed it.
 *
 * The double below models exactly that contract and nothing more: before `stop()` a forced pass cannot see the
 * final word; after `stop()` the transcript includes it. The engine must commit what the stopped stream holds.
 */
const TAIL_HELD = 'the quick brown fox jumps over the lazy';
const TAIL_DRAINED = 'the quick brown fox jumps over the lazy dog';

function lookaheadRuntime() {
    let stopped = false;
    const calls: string[] = [];
    const stream = {
        start: vi.fn(),
        addAudio: vi.fn(),
        transcribe: vi.fn(() => {
            calls.push(stopped ? 'transcribe-after-stop' : 'transcribe-before-stop');
            return { lines: [{ text: stopped ? TAIL_DRAINED : TAIL_HELD }] };
        }),
        stop: vi.fn(() => { calls.push('stop'); stopped = true; }),
        close: vi.fn(() => { calls.push('close'); }),
    };
    const transcriber = {
        transcribe: vi.fn(),
        createStream: vi.fn(() => stream),
        close: vi.fn(),
    } as unknown as MoonshineTranscriber;
    return { transcriber, stream, calls };
}

const fakeMic = () => ({
    sampleRate: 16_000,
    onFrame: () => () => {},
    offFrame: () => {},
    stop: () => {},
    close: () => {},
}) as never;

async function runningEngine() {
    const runtime = lookaheadRuntime();
    const engine = new MoonshineStreamingEngine({
        candidateId: 'moonshine:streaming-medium',
        modelArch: 'MOONSHINE_STREAMING_MEDIUM',
        loadTranscriber: async () => runtime.transcriber,
    });
    expect((await engine.init()).isOk).toBe(true);
    await engine.start(fakeMic());
    return { engine, ...runtime };
}

describe('#1263 — Stop commits the drained final, so the last word survives', () => {
    it('CASUALTY: stop() commits the transcript the STOPPED stream holds, including the last word', async () => {
        const { engine, calls, stream } = await runningEngine();

        await engine.stop();

        expect(await engine.getTranscript()).toBe(TAIL_DRAINED);
        expect(calls.indexOf('stop'), 'the stream is stopped before the committed read').toBeLessThan(calls.indexOf('transcribe-after-stop'));
        expect(calls, 'no committed read is taken from the not-yet-stopped stream').not.toContain('transcribe-before-stop');
        expect(stream.close).toHaveBeenCalledTimes(1);
    });

    it('CASUALTY: the facade commit (transcribe final) takes the same drained final', async () => {
        const { engine } = await runningEngine();

        const result = await engine.transcribe(new Float32Array(16_000), { final: true });

        expect(result.isOk).toBe(true);
        expect(result.isOk && result.data).toBe(TAIL_DRAINED);
    });

    it('CONTROL: a later stop() after the facade commit reuses the committed final and stops nothing twice', async () => {
        const { engine, stream } = await runningEngine();

        await engine.transcribe(new Float32Array(16_000), { final: true });
        await engine.stop();

        expect(await engine.getTranscript()).toBe(TAIL_DRAINED);
        expect(stream.stop).toHaveBeenCalledTimes(1);
        expect(stream.close).toHaveBeenCalledTimes(1);
    });
});
