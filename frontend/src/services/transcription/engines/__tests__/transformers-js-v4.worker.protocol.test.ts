// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANDIDATES } from '../../candidateRegistry';
import { buildWhisperDecodeOptions } from '../../decodeOptions';

const candidate = CANDIDATES['v4:base:q4'];
const identity = { model: candidate.model.id, dtype: candidate.model.dtype };
function decodeOptions(overrides?: Record<string, unknown>): Record<string, unknown> {
    const profile = candidate.execution.decode;
    if (profile.kind !== 'whisper') throw new Error('Expected Whisper test descriptor');
    return buildWhisperDecodeOptions(profile, 1, overrides);
}

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

        dispatchWorkerMessage({ id: 1, type: 'init', isE2E: true, ...identity });

        await vi.waitFor(() => {
            expect(postedMessages).toContainEqual({ id: 1, type: 'ready' });
        });
    });

    it.each(['onnx-community/whisper-base.en', 'onnx-community/distil-small.en'])(
        'forces declared WASM on a GPU-capable worker for %s', async (model) => {
            const detect = vi.fn(async () => ({ supported: true }));
            vi.doMock('../../utils/webgpuSupport', () => ({ detectWebGPUSupport: detect }));
            const pipeline = vi.fn(async () => vi.fn(async () => ({ text: 'warmup' })));
            vi.doMock('@huggingface/transformers', () => ({ env: {}, LogLevel: { ERROR: 'error' }, pipeline }));
            try {
                await loadWorkerModule();
                dispatchWorkerMessage({ id: 20, type: 'init', isE2E: false, ...identity, model, device: 'wasm' });
                await vi.waitFor(() => expect(postedMessages).toContainEqual(
                    expect.objectContaining({ id: 20, type: 'loaded', device: 'wasm-default' }),
                ));
                expect(pipeline).toHaveBeenCalledTimes(1);
                expect(pipeline.mock.calls[0]).toEqual([
                    'automatic-speech-recognition', model,
                    expect.not.objectContaining({ device: 'webgpu' }),
                ]);
                expect(detect).not.toHaveBeenCalled();
            } finally { vi.doUnmock('../../utils/webgpuSupport'); }
        },
    );

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
        dispatchWorkerMessage({ id: 2, type: 'init', isE2E: false, ...identity });

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
        dispatchWorkerMessage({ id: 3, type: 'init', isE2E: false, ...identity });

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

    it('contract: transcribe preserves descriptor-resolved anti-loop decode options (F2)', async () => {
        const transcriber = vi.fn(async () => ({ text: 'hello world' }));
        const pipeline = vi.fn(async () => transcriber);
        vi.doMock('@huggingface/transformers', () => ({ env: {}, LogLevel: { ERROR: 'error' }, pipeline }));

        await loadWorkerModule();
        dispatchWorkerMessage({ id: 5, type: 'init', isE2E: false, model: 'onnx-community/whisper-base.en', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } });
        await vi.waitFor(() => expect(postedMessages).toContainEqual(expect.objectContaining({ id: 5, type: 'ready' })));

        dispatchWorkerMessage({ id: 6, type: 'transcribe', audio: new Float32Array(16000), decodeOptions: decodeOptions() });
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
        dispatchWorkerMessage({ id: 8, type: 'transcribe', audio: new Float32Array(16000), decodeOptions: decodeOptions({ no_repeat_ngram_size: 3 }) });
        await vi.waitFor(() => expect(postedMessages).toContainEqual(expect.objectContaining({ id: 8, type: 'result' })));

        expect(transcriber).toHaveBeenCalledWith(
            expect.any(Float32Array),
            // override wins for the overridden key; the other default is preserved
            expect.objectContaining({ no_repeat_ngram_size: 3, condition_on_previous_text: false }),
        );
    });
    it.each([
        {},
        { model: identity.model },
        { dtype: identity.dtype },
        { model: identity.model, dtype: {} },
    ])('contract: incomplete init identity fails before pipeline loading: %j', async (payload) => {
        const pipeline = vi.fn();
        vi.doMock('@huggingface/transformers', () => ({ env: {}, LogLevel: { ERROR: 'error' }, pipeline }));
        await loadWorkerModule();
        dispatchWorkerMessage({ id: 30, type: 'init', isE2E: false, ...payload });
        await vi.waitFor(() => expect(postedMessages).toContainEqual(expect.objectContaining({
            id: 30, type: 'error', errorMessage: expect.stringContaining('MODEL_DESCRIPTOR_REQUIRED'),
        })));
        expect(pipeline).not.toHaveBeenCalled();
        expect(postedMessages.some(message => message.type === 'loaded' || message.type === 'ready')).toBe(false);
    });
});
