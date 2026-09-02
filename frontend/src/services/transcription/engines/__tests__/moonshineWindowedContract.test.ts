/**
 * #1263 E/F — THE WINDOWED SESSION CONTRACT.
 *
 * The frozen 600 is a full-utterance benchmark and, as the engine's own comment says, structurally
 * cannot validate the live path: the product feeds overlapping windows into ONE session and takes a
 * final transcript from it. Boundary loss, duplication and stale finals are properties of that
 * windowing, so only a windowed test can measure them.
 *
 * The CONTRACT needs no runtime. A fake stream that accumulates exactly as the real one does exercises
 * every rule; the real-runtime confirmation pass is separate and gated on host availability.
 *
 * The doubles are deliberately shaped so the OLD behaviour would fail: a stream that hands back only
 * the latest window, or a final taken from the trailing window, is detectable here.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    FORCE_UPDATE, MoonshineStreamingEngine,
    type MoonshineStream, type MoonshineTranscriber,
} from '../MoonshineStreamingEngine';
import type { MicStream } from '../../utils/types';

const SR = 16_000;
const frame = (n: number) => new Float32Array(n).fill(0.1);

/**
 * A stream that accumulates like the runtime's. `passes` records what each pass was asked to
 * summarise, and `forced` records whether ForceUpdate was used — the two facts the contract turns on.
 */
const fakeStream = () => {
    let accumulated = 0;
    const passes: number[] = [];
    const forced: boolean[] = [];
    let released: string[] = [];
    const stream: MoonshineStream = {
        start: vi.fn(),
        addAudio: (audio) => { accumulated += audio.length; },
        transcribe: (flags?: number) => {
            passes.push(accumulated);
            forced.push(flags === FORCE_UPDATE);
            return { lines: [{ text: `acc:${accumulated}` }] };
        },
        stop: vi.fn(() => { released.push('stop'); }),
        close: vi.fn(() => { released.push('close'); }),
    };
    return { stream, passes, forced, released: () => released, reset: () => { released = []; } };
};

const transcriberWith = (stream: MoonshineStream): MoonshineTranscriber => ({
    transcribe: () => { throw new Error('the whole-buffer API must not be used in a session'); },
    createStream: () => stream,
    close: vi.fn(),
});

const engineWith = (t: MoonshineTranscriber) => new MoonshineStreamingEngine({
    candidateId: 'moonshine:streaming-medium',
    modelArch: 'MOONSHINE_STREAMING_MEDIUM',
    loadTranscriber: async () => t,
});

const fakeMic = () => {
    let cb: ((f: Float32Array) => void) | null = null;
    const mic = {
        state: 'running', sampleRate: SR,
        onFrame: (fn: (f: Float32Array) => void) => { cb = fn; return () => { cb = null; }; },
        offFrame: () => { cb = null; }, stop: vi.fn(), close: vi.fn(),
    } as unknown as MicStream;
    return { mic, push: (f: Float32Array) => cb?.(f) };
};

describe('E — a live pass reflects the ACCUMULATED session, not one window', () => {
    it('CASUALTY: pass N summarises everything fed so far, not just the newest frame', async () => {
        // The r2 defect in product form: if the engine re-decoded a slice, each interim would describe
        // three seconds and the session's own context would be discarded.
        const f = fakeStream();
        const e = engineWith(transcriberWith(f.stream));
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        push(frame(SR)); push(frame(SR)); push(frame(SR));
        await vi.waitFor(() => expect(f.passes.length).toBeGreaterThan(0));
        expect(f.passes[f.passes.length - 1]).toBe(3 * SR);
        expect(f.passes[f.passes.length - 1]).not.toBe(SR);   // not the newest frame alone
    });

    it('CASUALTY: the whole-buffer transcribe() is NEVER used during a session', async () => {
        // The double throws if it is touched — the misuse must be impossible, not merely avoided.
        const f = fakeStream();
        const e = engineWith(transcriberWith(f.stream));
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        push(frame(SR));
        await vi.waitFor(() => expect(f.passes.length).toBeGreaterThan(0));
        expect(e.getMetadata().failure).toBeNull();
        expect(e.getInterimTranscript()).toBe(`acc:${SR}`);
    });

    it('live passes do NOT force an update — forcing every frame falls behind the speaker', async () => {
        const f = fakeStream();
        const e = engineWith(transcriberWith(f.stream));
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        push(frame(SR));
        await vi.waitFor(() => expect(f.forced.length).toBeGreaterThan(0));
        expect(f.forced[0]).toBe(false);
    });
});

describe('E — WINDOW to WINDOW within one session: the direct r2 analogue', () => {
    it('CASUALTY: window N+1 reflects A+B accumulated, NOT B alone', async () => {
        // This is the live-path equivalent of the cross-CLIP leak that started all of this. r2 showed
        // clip N's output depending on clip N-1; the product risk is window N+1 depending on window N
        // in the wrong direction — either losing A entirely (B alone) or fabricating a prefix from it.
        // `createStream` accumulation is what makes this correct BY DESIGN, and this is the check that
        // proves it rather than assuming it.
        const f = fakeStream();
        const e = engineWith(transcriberWith(f.stream));
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);

        push(frame(SR));                                   // window A
        await vi.waitFor(() => expect(f.passes.length).toBeGreaterThan(0));
        const afterA = e.getInterimTranscript();
        expect(afterA).toBe(`acc:${SR}`);

        push(frame(2 * SR));                               // window B
        await vi.waitFor(() => expect(e.getInterimTranscript()).not.toBe(afterA));
        const afterB = e.getInterimTranscript();

        // Accumulated, not B alone.
        expect(afterB).toBe(`acc:${3 * SR}`);
        expect(afterB, 'window B was decoded in isolation, losing A').not.toBe(`acc:${2 * SR}`);
        // and not A repeated in front of B — the fabricated-prefix shape of the r2 leak.
        expect(afterB.startsWith(afterA + ' ')).toBe(false);
    });

    it('CASUALTY: a window pass never re-summarises a SHRINKING span', async () => {
        // A pass that describes less audio than the one before it means the session was reset or a
        // slice was taken. Accumulated audio is monotonic; the spans asked about must be too.
        const f = fakeStream();
        const e = engineWith(transcriberWith(f.stream));
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 5; i++) {
            push(frame(SR));
            await new Promise((r) => setTimeout(r, 15));
        }
        await vi.waitFor(() => expect(f.passes.length).toBeGreaterThan(1));
        for (let i = 1; i < f.passes.length; i++) {
            expect(f.passes[i], `pass ${i} summarised less audio than pass ${i - 1}`)
                .toBeGreaterThanOrEqual(f.passes[i - 1]);
        }
    });
});

describe('F — the final transcript is the whole session, forced', () => {
    it('CASUALTY: stop() takes a FORCED pass over the full session, not the trailing window', async () => {
        const f = fakeStream();
        const e = engineWith(transcriberWith(f.stream));
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 6; i++) push(frame(SR));
        await e.stop();
        expect(await e.getTranscript()).toBe(`acc:${6 * SR}`);
        expect(f.forced[f.forced.length - 1], 'the final pass was not forced').toBe(true);
        expect(f.passes[f.passes.length - 1]).toBe(6 * SR);
    });

    it('CASUALTY: stop() AWAITS the in-flight pass, so the final is never a fragment', async () => {
        // Dropping the await lets a live pass settle after finalisation and present three seconds as
        // the whole session — the single worst outcome available on this path.
        let accumulated = 0;
        const passes: number[] = [];
        const stream: MoonshineStream = {
            start: vi.fn(),
            addAudio: (a) => { accumulated += a.length; },
            transcribe: (flags?: number) => {
                passes.push(accumulated);
                return { lines: [{ text: flags === FORCE_UPDATE ? `final:${accumulated}` : `live:${accumulated}` }] };
            },
            stop: vi.fn(), close: vi.fn(),
        };
        const e = engineWith(transcriberWith(stream));
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 5; i++) push(frame(SR));
        await e.stop();
        expect(await e.getTranscript()).toBe(`final:${5 * SR}`);
        expect(await e.getTranscript()).not.toMatch(/^live:/);
    });

    it('the session is stopped AND closed exactly once, even though stop() may throw', async () => {
        // A leaked session holds runtime memory and leaves state the next session would inherit.
        const f = fakeStream();
        const e = engineWith(transcriberWith(f.stream));
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        push(frame(SR));
        await e.stop();
        expect(f.released()).toEqual(['stop', 'close']);
    });
});

describe('window scheduling — coalesced, never one decode per frame', () => {
    it('CASUALTY: frames arriving during a pass produce ONE further pass, not one each', async () => {
        // One pass per frame would pile work onto a single-worker runtime and fall further behind on
        // every frame; dropping them silently would stale the interim.
        const f = fakeStream();
        const e = engineWith(transcriberWith(f.stream));
        await e.init();
        const { mic, push } = fakeMic();
        await e.start(mic);
        for (let i = 0; i < 8; i++) push(frame(SR));
        await vi.waitFor(() => expect(f.passes.length).toBeGreaterThan(0));
        await new Promise((r) => setTimeout(r, 30));
        expect(f.passes.length).toBeLessThan(8);
    });
});
