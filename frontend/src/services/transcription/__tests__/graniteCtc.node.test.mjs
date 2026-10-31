import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraniteCtcModule } from '../engines/granite/ctc-core.js';
import pins from '../engines/granite/assetPins.json' with { type: 'json' };

function harness({ failRun = false, beforeRun = null } = {}) {
    const allocated = [];
    let creates = 0, releases = 0, options;
    class Tensor {
        constructor(type, data, dims) { Object.assign(this, { type, data, dims, disposals: 0 }); allocated.push(this); }
        dispose() { this.disposals++; }
    }
    const ort = { Tensor, InferenceSession: { create: async (_model, opts) => {
        creates++; options = opts;
        return { release: async () => { releases++; }, run: async () => {
            beforeRun?.(files);
            if (failRun) throw new Error('unsupported kernel');
            return { ids: new Tensor('int32', new Int32Array([1, 1, 0, 1]), [4]),
                top_logprob: new Tensor('float32', new Float32Array([-.1, -.1, -.2, -.1]), [4]) };
        } };
    } } };
    const enc = x => new TextEncoder().encode(JSON.stringify(x));
    const files = { 'model.onnx': new Uint8Array([1]), 'model.onnx.data': new Uint8Array([2]),
        'frontend_config.json': enc({ n_fft: 4, input_dim: 2, pad_multiple: 4, sample_rate: 16000,
            num_special_tokens: 1, blank_id: 0 }),
        'vocab.json': enc(['▁hello']), 'mel_filters.bin': new Float32Array(4), 'stft_window.bin': new Float32Array(4) };
    const module = createGraniteCtcModule(ort, files);
    return { ...module, allocated, files, load: device => module.CtcEngine.load({ modelFile: 'model.onnx', device }),
        stats: () => ({ creates, releases, options }) };
}

test('CTC token collapse preserves words separated by blanks and decodes UTF-8 bytes', () => {
    const { ctcCollapse, CtcDecoder } = harness();
    assert.deepEqual(ctcCollapse([1, 1, 0, 1], { numSpecialTokens: 1 }), [1, 1]);
    const decoder = new CtcDecoder(['▁hello', '<0xC3>', '<0xA9>'], 1);
    assert.equal(decoder.decode([1, 2, 3]), 'helloé');
});

for (const device of ['wasm', 'webgpu']) {
    test(`${device} warmup failure releases session/tensors, never falls back`, async () => {
        const h = harness({ failRun: true });
        await assert.rejects(h.load(device), /warmup failed: unsupported kernel/);
        assert.equal(h.stats().creates, 1);
        assert.equal(h.stats().releases, 1);
        assert.deepEqual(h.stats().options.executionProviders, [device]);
        assert.ok(h.allocated.every(t => t.disposals === 1));
    });
}

test('load requires explicit export/backend, refuses fallback and releases successful warmup outputs', async () => {
    const h = harness();
    await assert.rejects(h.CtcEngine.load(), /Explicit pinned/);
    await assert.rejects(h.CtcEngine.load({ modelFile: 'model.onnx' }), /explicit backend/);
    await assert.rejects(h.CtcEngine.load({ modelFile: 'model.onnx', device: 'webgpu', allowFallback: true }), /without fallback/);
    const engine = await h.load('wasm');
    assert.equal(h.stats().options.externalData[0].path, 'model.onnx.data');
    assert.ok(h.allocated.every(t => t.disposals === 1));
    await engine.close(); await engine.close();
    assert.equal(h.stats().releases, 1);
    await assert.rejects(engine.transcribe(new Float32Array(1)), /closed/);
});

test('missing verified asset fails without any runtime session or network substitution', async () => {
    const h = harness();
    await assert.rejects(h.CtcEngine.load({ modelFile: 'absent.onnx', device: 'wasm' }), /Explicit pinned/);
    assert.equal(h.stats().creates, 0);
});

test('consumes graph and external weights before warmup while the retained engine still decodes', async () => {
    const h = harness({ beforeRun(files) {
        assert.equal(Object.hasOwn(files, 'model.onnx'), false, 'graph retained after session creation');
        assert.equal(Object.hasOwn(files, 'model.onnx.data'), false, 'external weights retained after session creation');
    } });
    const engine = await h.load('webgpu');
    assert.equal(engine.closed, false);
    assert.ok(Object.hasOwn(h.files, 'mel_filters.bin'));
    assert.ok(Object.hasOwn(h.files, 'vocab.json'));
    engine.frontend.compute = () => ({ data: new Float32Array(32), frames: 16, dim: 2 });
    assert.equal((await engine.transcribe(new Float32Array(16), { applyAgc: false })).text, 'hello hello');
    await engine.close();
    await assert.rejects(h.load('webgpu'), /Explicit pinned/);
    assert.equal(h.stats().creates, 1);
});

test('decode and decoder failure both release inference inputs and outputs', async () => {
    const h = harness();
    const engine = await h.load('wasm');
    // Lifecycle test: synthetic feature data, not a frontend-parity/model test.
    engine.frontend.compute = () => ({ data: new Float32Array(32), frames: 16, dim: 2 });
    const result = await engine.transcribe(new Float32Array(16), { applyAgc: false });
    assert.equal(result.text, 'hello hello');
    assert.ok(h.allocated.every(t => t.disposals === 1));
    engine.decoder.decode = () => { throw new Error('decode failed'); };
    await assert.rejects(engine.transcribe(new Float32Array(16), { applyAgc: false }), /decode failed/);
    assert.ok(h.allocated.every(t => t.disposals === 1));
    await engine.close();
});

test('manifest preserves six model assets and exactly pinned browser runtime, not native runtime', () => {
    const model = pins.files.filter(f => f.path.startsWith('onnx-ctc/'));
    const runtime = pins.files.filter(f => f.path.startsWith('ort/'));
    assert.equal(model.length, 6);
    assert.equal(runtime.length, 3);
    assert.equal(model.reduce((n,f) => n + f.bytes, 0), 312293134);
    assert.equal(runtime.reduce((n,f) => n + f.bytes, 0), 27081060);
    assert.ok(pins.files.every(f => f.url.includes(`/resolve/${pins.revision}/`) && /^[a-f0-9]{64}$/.test(f.sha256)));
});
