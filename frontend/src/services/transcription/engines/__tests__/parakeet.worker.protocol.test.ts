// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createParakeetWorker } from '../parakeet/parakeet.worker';
import { CANDIDATES } from '../../candidateRegistry';
import { requiredParakeetFiles, type ParakeetModelInstance, type ParakeetRuntimeBundle,
    type ParakeetTdtProfile, type ParakeetWorkerReply, type RuntimeTensor } from '../parakeet/contracts';

const configured = CANDIDATES['parakeet:tdt-v3:int8'].execution.decode;
if (configured.kind !== 'parakeet-tdt') throw new Error('Missing TDT profile');
const profile: ParakeetTdtProfile = { ...configured, vocabularySize: 3, blankId: 2 };
const identity = { package: 'parakeet.js', version: '1.4.4', ortVersion: '1.24.1' } as const;
// Node's TextEncoder creates arrays in its own realm; postMessage would clone them into the worker realm.
const encode = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(new TextEncoder().encode(text));

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function harness() {
    const replies: ParakeetWorkerReply[] = [];
    const tensors: TestTensor[] = [];
    const urls = new Set<string>();
    const created: Array<{ bytes: Uint8Array; mime: string; url: string }> = [];
    let urlId = 0;
    class TestTensor implements RuntimeTensor {
        readonly dispose = vi.fn();
        constructor(readonly type: 'float32' | 'int32' | 'int64',
            readonly data: Float32Array | Int32Array | BigInt64Array, readonly dims: number[]) { tensors.push(this); }
    }
    const encoderRun = vi.fn(async (_feeds: Record<string, RuntimeTensor>) => ({
        outputs: new TestTensor('float32', Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]), [1, 4, 2]),
    }));
    const decoderRun = vi.fn(async (_feeds: Record<string, RuntimeTensor>): Promise<Record<string, RuntimeTensor>> => ({
        outputs: new TestTensor('float32', new Float32Array(profile.vocabularySize + 5), [1, 1, profile.vocabularySize + 5]),
        output_states_1: new TestTensor('float32', new Float32Array(1280), [2, 1, 640]),
        output_states_2: new TestTensor('float32', new Float32Array(1280), [2, 1, 640]),
    }));
    const ort: ParakeetRuntimeBundle['ort'] = { env: { versions: { common: '1.24.1' }, wasm: {} }, Tensor: TestTensor };
    const model = {
        ort,
        encoderSession: { inputNames: ['audio_signal', 'length'], outputNames: ['outputs'], run: encoderRun },
        joinerSession: { inputNames: ['encoder_outputs', 'targets', 'target_length', 'input_states_1', 'input_states_2'],
            outputNames: ['outputs', 'output_states_1', 'output_states_2'], run: decoderRun },
        computeFeatures: vi.fn(async () => ({ features: new Float32Array(256), T: 2, melBins: 128, validLength: 2 })),
        getStreamingConstants: vi.fn(() => ({ melBins: 128, subsampling: 8, windowStride: 0.01, blankId: profile.blankId })),
        resetMelCache: vi.fn(), clearIncrementalCache: vi.fn(),
        transcribe: vi.fn<ParakeetModelInstance['transcribe']>().mockResolvedValue({ utterance_text: 'TDT segment' }),
    };
    const runtime: ParakeetRuntimeBundle = {
        bindingIdentity: { ...identity },
        ort,
        ParakeetModel: { fromUrls: vi.fn(async () => model) },
    };
    const files = Object.fromEntries(requiredParakeetFiles(profile).map(file => [file, new Uint8Array([1])]));
    files[profile.configurationFile] = encode(JSON.stringify({
        model_type: 'nemo-conformer-tdt', features_size: 128, subsampling_factor: 8,
    }));
    files[profile.vocabularyFile] = encode('▁a 0\nb 1\n<blk> 2\n');
    const loadRuntime = vi.fn(async () => runtime);
    const handle = createParakeetWorker({ loadRuntime, postMessage: reply => replies.push(reply),
        createUrl: (bytes, mime) => {
            const url = `blob:owned-${++urlId}`; urls.add(url); created.push({ bytes, mime, url }); return url;
        }, revokeUrl: url => { urls.delete(url); },
    });
    const initialize = () => handle({ id: 1, type: 'init', profile: { ...profile }, runtime: { ...identity },
        files, runtimeUrl: 'blob:verified-binding' });
    return { handle, initialize, runtime, model, files, replies, urls, created, loadRuntime,
        encoderRun, decoderRun, tensors, TestTensor };
}

describe('Parakeet owned worker protocol', () => {
    it('refuses a model bound to a different ORT singleton before tensor probing', async () => {
        const h = harness();
        h.model.ort = { ...h.runtime.ort };
        await h.initialize();
        expect(h.replies).toEqual([{ id: 1, ok: false, error: 'Parakeet model used a different ORT instance' }]);
        expect(h.encoderRun).not.toHaveBeenCalled();
    });
    it('binds verified WASM first, probes real TDT feed shapes and emits only decoded segment text', async () => {
        const h = harness();
        await h.initialize();
        expect(h.loadRuntime).toHaveBeenCalledWith('blob:verified-binding');
        expect(h.replies).toEqual([{ id: 1, ok: true, type: 'ready', backend: 'wasm', ortVersion: '1.24.1' }]);
        expect(h.runtime.ort.env.wasm).toMatchObject({ numThreads: 1, proxy: false,
            wasmPaths: { mjs: h.created[0].url, wasm: h.created[1].url } });
        expect(h.created[1].bytes).toBe(h.files[profile.wasmBinaryFile]);
        expect(h.runtime.ParakeetModel.fromUrls).toHaveBeenCalledWith({
            encoderUrl: h.created[2].url, decoderUrl: h.created[3].url, tokenizerUrl: h.created[4].url,
            backend: 'wasm', cpuThreads: 1, preprocessorBackend: 'js', nMels: 128,
            subsampling: 8, windowStride: 0.01, enableGraphCapture: false,
        });
        const encodedFeeds = h.encoderRun.mock.calls[0][0];
        expect(encodedFeeds.audio_signal.dims).toEqual([1, 128, 2]);
        expect(encodedFeeds.length.data).toEqual(BigInt64Array.from([2n]));
        const decodedFeeds = h.decoderRun.mock.calls[0][0];
        expect(decodedFeeds.encoder_outputs.data).toEqual(Float32Array.from([1, 3, 5, 7]));
        expect(decodedFeeds.targets.data).toEqual(Int32Array.from([2]));
        expect(decodedFeeds.input_states_1.dims).toEqual([2, 1, 640]);
        expect(h.tensors.every(tensor => tensor.dispose.mock.calls.length === 1)).toBe(true);
        expect(h.model.clearIncrementalCache).toHaveBeenCalledTimes(1);
        expect(h.model.resetMelCache).toHaveBeenCalledTimes(1);
        const audio = new Float32Array([0.5]);
        await h.handle({ id: 2, type: 'decode', audio });
        expect(h.model.transcribe).toHaveBeenLastCalledWith(audio, 16000);
        expect(h.replies[h.replies.length - 1]).toEqual({ id: 2, ok: true, type: 'transcript', text: 'TDT segment' });
        // The verified package exposes no public dispose method; this working double has none.
        expect(h.model).not.toHaveProperty('dispose');
    });

    it.each(['missing', 'extra'] as const)('refuses %s verified inventory before runtime loading', async (change) => {
        const h = harness();
        if (change === 'missing') delete h.files[profile.wasmBinaryFile];
        else h.files['unlisted.onnx'] = new Uint8Array([1]);
        await h.initialize();
        expect(h.loadRuntime).not.toHaveBeenCalled();
        expect(h.replies[h.replies.length - 1]).toMatchObject({ ok: false, error: expect.stringContaining('inventory mismatch') });
    });

    it('refuses an ORT version mismatch without calling the model loader', async () => {
        const h = harness(); h.runtime.ort.env.versions!.common = '1.30.0';
        await h.initialize();
        expect(h.runtime.ParakeetModel.fromUrls).not.toHaveBeenCalled();
        expect(h.replies[h.replies.length - 1]).toMatchObject({ ok: false, error: expect.stringContaining('binding mismatch') });
    });

    it.each(['config', 'blank', 'duplicate'] as const)('refuses mismatched %s metadata before code loading', async (change) => {
        const h = harness();
        if (change === 'config') h.files[profile.configurationFile] = encode('{}');
        else h.files[profile.vocabularyFile] = encode(change === 'blank'
            ? '▁a 0\nb 1\nother 2\n' : '▁a 0\nb 0\n<blk> 2\n');
        await h.initialize();
        expect(h.loadRuntime).not.toHaveBeenCalled();
        expect(h.replies[h.replies.length - 1]).toMatchObject({ ok: false });
    });

    it('refuses missing recurrent output names instead of accepting upstream compatibility fallback', async () => {
        const h = harness(); h.model.joinerSession.outputNames = ['outputs'];
        await h.initialize();
        expect(h.replies[h.replies.length - 1]).toMatchObject({ ok: false, error: expect.stringContaining('recurrent TDT tensor contract') });
        expect(h.urls.size).toBe(0);
    });

    it('refuses absent duration logits instead of accepting an inferred zero step', async () => {
        const h = harness();
        h.decoderRun.mockImplementationOnce(async () => ({
            outputs: new h.TestTensor('float32', new Float32Array(profile.vocabularySize), [1, 1, profile.vocabularySize]),
            output_states_1: new h.TestTensor('float32', new Float32Array(1280), [2, 1, 640]),
            output_states_2: new h.TestTensor('float32', new Float32Array(1280), [2, 1, 640]),
        }));
        await h.initialize();
        expect(h.replies[h.replies.length - 1]).toMatchObject({ ok: false, error: expect.stringContaining('duration logits') });
        expect(h.model.transcribe).not.toHaveBeenCalled();
        expect(h.tensors.every(tensor => tensor.dispose.mock.calls.length === 1)).toBe(true);
        expect(h.urls.size).toBe(0);
    });

    it('refuses missing recurrent state tensors even when their output names are advertised', async () => {
        const h = harness();
        h.decoderRun.mockImplementationOnce(async () => ({
            outputs: new h.TestTensor('float32', new Float32Array(profile.vocabularySize + 5), [1, 1, profile.vocabularySize + 5]),
        }));
        await h.initialize();
        expect(h.replies[h.replies.length - 1]).toMatchObject({ ok: false, error: expect.stringContaining('recurrent state warmup failed') });
        expect(h.tensors.every(tensor => tensor.dispose.mock.calls.length === 1)).toBe(true);
    });

    it.each(['feature', 'transcript'] as const)('a failed %s warmup cannot publish READY', async (where) => {
        const h = harness();
        if (where === 'feature') h.model.computeFeatures.mockRejectedValueOnce(new Error('feature failed'));
        else h.model.transcribe.mockRejectedValueOnce(new Error('decode failed'));
        await h.initialize();
        expect(h.replies).toHaveLength(1);
        expect(h.replies[0]).toMatchObject({ ok: false });
        expect(h.urls.size).toBe(0);
        expect(h.tensors.every(tensor => tensor.dispose.mock.calls.length === 1)).toBe(true);
        await h.initialize();
        expect(h.replies[h.replies.length - 1]).toMatchObject({ ok: false, error: expect.stringContaining('already attempted') });
    });

    it('releases all probe tensors when an actual encoder invocation rejects', async () => {
        const h = harness(); h.encoderRun.mockRejectedValueOnce(new Error('encoder session failed'));
        await h.initialize();
        expect(h.replies[h.replies.length - 1]).toMatchObject({ ok: false, error: 'encoder session failed' });
        expect(h.tensors).toHaveLength(2);
        expect(h.tensors.every(tensor => tensor.dispose.mock.calls.length === 1)).toBe(true);
    });

    it('refuses decode before initialization without loading code', async () => {
        const h = harness();
        await h.handle({ id: 4, type: 'decode', audio: new Float32Array([0.1]) });
        expect(h.replies).toEqual([{ id: 4, ok: false, error: 'Parakeet worker not ready' }]);
        expect(h.loadRuntime).not.toHaveBeenCalled();
    });

    it('serializes decoder calls and does not mix independent PCM requests', async () => {
        const h = harness(); await h.initialize();
        const gate = deferred<{ utterance_text: string }>();
        const entered = deferred<void>();
        h.model.transcribe.mockImplementationOnce(() => { entered.resolve(undefined); return gate.promise; });
        const firstAudio = new Float32Array([0.1]);
        const secondAudio = new Float32Array([0.2]);
        const first = h.handle({ id: 2, type: 'decode', audio: firstAudio });
        await entered.promise;
        const second = h.handle({ id: 3, type: 'decode', audio: secondAudio });
        expect(h.model.transcribe).toHaveBeenCalledTimes(2); // Warmup and first request only.
        gate.resolve({ utterance_text: 'first' });
        await first; await second;
        expect(h.model.transcribe.mock.calls.slice(1)).toEqual([[firstAudio, 16000], [secondAudio, 16000]]);
        expect(h.replies.slice(1)).toEqual([
            { id: 2, ok: true, type: 'transcript', text: 'first' },
            { id: 3, ok: true, type: 'transcript', text: 'TDT segment' },
        ]);
    });
});
