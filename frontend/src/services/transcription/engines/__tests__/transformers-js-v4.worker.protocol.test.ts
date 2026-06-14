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
    await import('../transformers-js-v4.worker');
}

function dispatchWorkerMessage(data: WorkerMessage): void {
    const handler = self.onmessage as ((event: MessageEvent<WorkerMessage>) => void) | null;
    if (!handler) {
        throw new Error('Worker onmessage handler was not installed');
    }
    handler({ data } as MessageEvent<WorkerMessage>);
}

describe('transformers-js-v4.worker protocol contract', () => {
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

    it('contract: warm-up failure does not fail init after the v4 model loads', async () => {
        const transcriber = vi.fn(async () => {
            throw new Error('warmup decode failed');
        });
        const pipeline = vi.fn(async () => transcriber);
        vi.doMock('@huggingface/transformers', () => ({
            env: {},
            LogLevel: { ERROR: 'error' },
            pipeline,
        }));

        await loadWorkerModule();
        dispatchWorkerMessage({ id: 2, type: 'init', isE2E: false });

        await vi.waitFor(() => {
            expect(postedMessages).toContainEqual(expect.objectContaining({
                id: 2,
                type: 'loaded',
                device: 'wasm-default',
            }));
            expect(postedMessages).toContainEqual({ id: 2, type: 'ready' });
        });

        expect(postedMessages).not.toContainEqual(expect.objectContaining({
            id: 2,
            type: 'error',
        }));
    });

    it('contract: model load failure responds with init error instead of ready', async () => {
        const pipeline = vi.fn(async () => {
            throw new Error('v4 model artifact unavailable');
        });
        vi.doMock('@huggingface/transformers', () => ({
            env: {},
            LogLevel: { ERROR: 'error' },
            pipeline,
        }));

        await loadWorkerModule();
        dispatchWorkerMessage({ id: 3, type: 'init', isE2E: false });

        await vi.waitFor(() => {
            expect(postedMessages).toEqual([
                expect.objectContaining({
                    id: 3,
                    type: 'error',
                    errorMessage: 'v4 model artifact unavailable',
                }),
            ]);
        });
        expect(postedMessages).not.toContainEqual(expect.objectContaining({ id: 3, type: 'ready' }));
    });

    it('contract: init loads the model/dtype from the load payload (model/dtype variant threading)', async () => {
        const transcriber = vi.fn(async () => ({ text: '' }));
        const pipeline = vi.fn(async () => transcriber);
        vi.doMock('@huggingface/transformers', () => ({
            env: {},
            LogLevel: { ERROR: 'error' },
            pipeline,
        }));

        await loadWorkerModule();
        const dtype = { encoder_model: 'fp32', decoder_model_merged: 'q4' };
        dispatchWorkerMessage({ id: 4, type: 'init', isE2E: false, model: 'onnx-community/whisper-base.en', dtype });

        await vi.waitFor(() => {
            expect(postedMessages).toContainEqual(expect.objectContaining({
                id: 4,
                type: 'loaded',
                model: 'onnx-community/whisper-base.en',
            }));
        });
        // The worker must use the payload model + dtype, NOT the hardcoded tiny default.
        expect(pipeline).toHaveBeenCalledWith(
            'automatic-speech-recognition',
            'onnx-community/whisper-base.en',
            expect.objectContaining({ dtype }),
        );
    });

    it('contract: transcribe applies the conservative anti-loop decode defaults (F2)', async () => {
        const transcriber = vi.fn(async () => ({ text: 'hello world' }));
        const pipeline = vi.fn(async () => transcriber);
        vi.doMock('@huggingface/transformers', () => ({ env: {}, LogLevel: { ERROR: 'error' }, pipeline }));

        await loadWorkerModule();
        dispatchWorkerMessage({ id: 5, type: 'init', isE2E: false, model: 'onnx-community/whisper-base.en', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
        await vi.waitFor(() => expect(postedMessages).toContainEqual(expect.objectContaining({ id: 5, type: 'ready' })));

        dispatchWorkerMessage({ id: 6, type: 'transcribe', audio: new Float32Array(16000) });
        await vi.waitFor(() => expect(postedMessages).toContainEqual(expect.objectContaining({ id: 6, type: 'result' })));

        // The real transcribe call (not the warm-up) carries the anti-loop defaults.
        expect(transcriber).toHaveBeenCalledWith(
            expect.any(Float32Array),
            expect.objectContaining({ no_repeat_ngram_size: 6, condition_on_previous_text: false }),
        );
    });

    it('contract: a proof-hook decode override wins over the anti-loop defaults', async () => {
        const transcriber = vi.fn(async () => ({ text: 'hello' }));
        const pipeline = vi.fn(async () => transcriber);
        vi.doMock('@huggingface/transformers', () => ({ env: {}, LogLevel: { ERROR: 'error' }, pipeline }));

        await loadWorkerModule();
        dispatchWorkerMessage({ id: 7, type: 'init', isE2E: false, model: 'onnx-community/whisper-base.en', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
        await vi.waitFor(() => expect(postedMessages).toContainEqual(expect.objectContaining({ id: 7, type: 'ready' })));

        // Proof hook sets no_repeat_ngram_size=3; the worker receives it via the message's decodeOptions.
        dispatchWorkerMessage({ id: 8, type: 'transcribe', audio: new Float32Array(16000), decodeOptions: { no_repeat_ngram_size: 3 } });
        await vi.waitFor(() => expect(postedMessages).toContainEqual(expect.objectContaining({ id: 8, type: 'result' })));

        expect(transcriber).toHaveBeenCalledWith(
            expect.any(Float32Array),
            // override wins for the overridden key; the other default is preserved
            expect.objectContaining({ no_repeat_ngram_size: 3, condition_on_previous_text: false }),
        );
    });
});
