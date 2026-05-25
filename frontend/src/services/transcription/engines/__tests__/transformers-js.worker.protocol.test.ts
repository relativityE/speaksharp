// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type WorkerMessage = {
    id: number;
    type: string;
    [key: string]: unknown;
};

const postedMessages: WorkerMessage[] = [];

function installWorkerPostMessageSpy(): void {
    Object.defineProperty(self, 'postMessage', {
        configurable: true,
        value: vi.fn((message: WorkerMessage) => {
            postedMessages.push(message);
        }),
    });
}

async function loadWorkerModule(): Promise<void> {
    await import('../transformers-js.worker');
}

function dispatchWorkerMessage(data: WorkerMessage): void {
    const handler = self.onmessage as ((event: MessageEvent<WorkerMessage>) => void) | null;
    if (!handler) {
        throw new Error('Worker onmessage handler was not installed');
    }
    handler({ data } as MessageEvent<WorkerMessage>);
}

describe('transformers-js.worker protocol contract', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        postedMessages.length = 0;
        installWorkerPostMessageSpy();
    });

    afterEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    it('contract: E2E init responds with ready without loading the model', async () => {
        await loadWorkerModule();

        dispatchWorkerMessage({ id: 1, type: 'init', isE2E: true });

        await vi.waitFor(() => {
            expect(postedMessages).toContainEqual({ id: 1, type: 'ready' });
        });
    });

    it('contract: transcribe before init responds with an error instead of hanging', async () => {
        await loadWorkerModule();

        dispatchWorkerMessage({ id: 2, type: 'transcribe', audio: new Float32Array([0.1, -0.1]) });

        await vi.waitFor(() => {
            expect(postedMessages).toEqual([
                expect.objectContaining({
                    id: 2,
                    type: 'error',
                    errorMessage: expect.stringContaining('not initialized'),
                }),
            ]);
        });
    });

    it('contract: initialized worker returns a result message for transcribe requests', async () => {
        let observedAudio: Float32Array | null = null;
        let observedOptions: Record<string, unknown> | null = null;
        const transcriber = vi.fn(async (audio: Float32Array, options: Record<string, unknown>) => {
            observedAudio = audio;
            observedOptions = options;
            return { text: 'the stale smell of old beer' };
        });
        const pipeline = vi.fn(async () => transcriber);
        vi.doMock('@xenova/transformers', () => ({
            env: {},
            pipeline,
        }));

        await loadWorkerModule();
        dispatchWorkerMessage({ id: 3, type: 'init', isE2E: false });

        await vi.waitFor(() => {
            expect(postedMessages).toContainEqual(expect.objectContaining({ id: 3, type: 'ready' }));
        });

        const audio = new Float32Array(16_000);
        audio[0] = 0.25;
        dispatchWorkerMessage({ id: 4, type: 'transcribe', audio });

        await vi.waitFor(() => {
            expect(postedMessages).toContainEqual(expect.objectContaining({
                id: 4,
                type: 'result',
                transcript: 'the stale smell of old beer',
                audioLengthSeconds: 1,
            }));
        });

        expect(pipeline).toHaveBeenCalledWith(
            'automatic-speech-recognition',
            'whisper-tiny.en',
            expect.objectContaining({ quantized: true }),
        );
        expect(observedAudio).toBe(audio);
        expect(observedOptions).toMatchObject({
            chunk_length_s: 30,
            stride_length_s: 0,
            return_timestamps: false,
        });
    });

    it('contract: destroy clears the worker and acknowledges the request', async () => {
        await loadWorkerModule();

        dispatchWorkerMessage({ id: 5, type: 'destroy' });

        await vi.waitFor(() => {
            expect(postedMessages).toContainEqual({ id: 5, type: 'destroyed' });
        });
    });
});
