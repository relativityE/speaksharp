import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoonshineStreamingEngine, type MoonshineTranscriber } from '../MoonshineStreamingEngine';

/**
 * #1263 RWT-07 / NEW-01 — a cold Moonshine acquisition fails only when it STALLS.
 *
 * The pinned medium set is ~305 MB. A flat timer cannot tell a slow-but-healthy transfer from a dead one, so it failed
 * transfers that were still making progress and orphaned the download. The limit is now the longest the loader may go
 * without reporting progress. Fake timers make every interval exact; the loader is the only double.
 */
const transcriberDouble = () => {
    const close = vi.fn(() => {});
    const t = { transcribe: vi.fn(), createStream: vi.fn(), close } as unknown as MoonshineTranscriber;
    return { t, close };
};

const engineWithLoader = (loadTranscriber: NonNullable<ConstructorParameters<typeof MoonshineStreamingEngine>[0]['loadTranscriber']>) =>
    new MoonshineStreamingEngine({
        candidateId: 'moonshine:streaming-medium',
        modelArch: 'MOONSHINE_STREAMING_MEDIUM',
        loadTranscriber,
    });

afterEach(() => {
    vi.useRealTimers();
});

describe('#1263 RWT-07 — Moonshine acquisition fails on a stall, never on a progressing transfer', () => {
    it('CASUALTY: a transfer that keeps reporting progress well past the stall limit is adopted', async () => {
        vi.useFakeTimers();
        const { t, close } = transcriberDouble();
        const engine = engineWithLoader((_arch, onProgress) => new Promise<MoonshineTranscriber>((resolve) => {
            let fraction = 0;
            const tick = setInterval(() => {
                fraction += 0.25;
                onProgress?.(Math.min(1, fraction));
                if (fraction >= 1) {
                    clearInterval(tick);
                    resolve(t);
                }
            }, 40);
        }));

        // 60 ms may pass without progress; the transfer reports every 40 ms and completes at 160 ms.
        const initing = engine.init(60);
        await vi.advanceTimersByTimeAsync(161);
        const result = await initing;

        expect(result.isOk, 'a transfer still making progress must not be failed on a timer').toBe(true);
        expect(close).not.toHaveBeenCalled();
        expect(engine.getMetadata().failure).toBeNull();
    });

    it('CASUALTY: a transfer that stops reporting progress fails at the stall limit, names the stall, and its late runtime is destroyed', async () => {
        vi.useFakeTimers();
        const { t, close } = transcriberDouble();
        let release: () => void = () => {};
        const engine = engineWithLoader((_arch, onProgress) => new Promise<MoonshineTranscriber>((resolve) => {
            setTimeout(() => onProgress?.(0.1), 20);
            release = () => resolve(t);
        }));

        const initing = engine.init(60);
        // Progress at 20 ms re-arms the limit to 80 ms; nothing arrives after that.
        await vi.advanceTimersByTimeAsync(79);
        await Promise.resolve();
        let settledEarly = false;
        void initing.then(() => { settledEarly = true; });
        await Promise.resolve();
        expect(settledEarly, 'the re-armed limit has not elapsed yet').toBe(false);

        await vi.advanceTimersByTimeAsync(2);
        const result = await initing;
        expect(result.isOk).toBe(false);
        expect(engine.getMetadata().failure?.message).toMatch(/no progress for 60ms/);

        // The abandoned load still finishes later; it must be destroyed, never adopted.
        release();
        await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    });

    it('CONTROL: a loader that never reports progress keeps the previous wall-clock behaviour', async () => {
        vi.useFakeTimers();
        const engine = engineWithLoader(() => new Promise<MoonshineTranscriber>(() => { /* never settles */ }));

        const initing = engine.init(30);
        await vi.advanceTimersByTimeAsync(31);
        const result = await initing;

        expect(result.isOk).toBe(false);
        expect(engine.getMetadata().failure?.message).toMatch(/no progress for 30ms/);
    });
});
