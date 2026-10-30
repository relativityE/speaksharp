import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

async function harness({ holdAssets = false, backend = 'wasm' } = {}) {
    const workers = [], urls = new Set();
    let releaseAssets;
    const barrier = new Promise(resolve => { releaseAssets = resolve; });
    class Worker {
        constructor() { workers.push(this); }
        postMessage(message) {
            this.last = message;
            queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ok: true,
                ...(message.type === 'init' ? { backend } : { text: 'decoded' }) } }));
        }
        terminate() { this.terminated = true; }
    }
    class BlobURL extends URL {
        static createObjectURL() { const u = `blob:${urls.size}-${Math.random()}`; urls.add(u); return u; }
        static revokeObjectURL(u) { urls.delete(u); }
    }
    const context = createContext({ Worker, URL: BlobURL, Blob, AbortController,
        window: { location: { href: 'https://app.example/' } }, navigator: {},
        clearTimeout, setTimeout, fetch: () => { throw new Error('unexpected network'); } });
    const source = stripTypeScriptTypes(await readFile(new URL('../engines/GraniteCtcEngine.ts', import.meta.url), 'utf8'), { mode: 'transform' });
    const module = new SourceTextModule(source, { context });
    await module.link(specifier => {
        const assets = specifier === '../moonshineAssetPins';
        return new SyntheticModule([assets ? 'fetchVerifiedAssets' : 'default'], function () {
            this.setExport(assets ? 'fetchVerifiedAssets' : 'default', assets ? async () => {
                if (holdAssets) await barrier;
                return Object.fromEntries(['ort.all.min.js', 'ort-wasm-simd-threaded.jsep.mjs',
                    'ort-wasm-simd-threaded.jsep.wasm'].map(key => [key, new Uint8Array([1])]));
            } : 'owned-source');
        }, { context });
    });
    await module.evaluate();
    const engine = new module.namespace.GraniteCtcEngine({ modelFile: 'model.onnx', backend: 'wasm', applyAgc: true,
        assets: [{ file: 'model.onnx', bytes: 1, sha256: 'synthetic', url: 'https://unused.example/' }] });
    return { engine, workers, urls, releaseAssets };
}

test('adapter binds backend evidence, decodes through worker and cleans all object URLs', async () => {
    const h = await harness();
    assert.equal((await h.engine.init()).isOk, true);
    assert.equal(h.engine.getRuntimeEvidence().backend, 'wasm');
    assert.equal(h.engine.getRuntimeEvidence().modelId, null);
    await h.engine.start({ sampleRate: 16000 });
    await assert.rejects(h.engine.start({ sampleRate: 48000 }), /16 kHz/);
    assert.equal((await h.engine.transcribe(new Float32Array([.1]))).data, 'decoded');
    await h.engine.destroy();
    assert.equal(h.engine.getRuntimeEvidence(), null);
    assert.equal(h.urls.size, 0);
    assert.equal(h.workers[0].terminated, true);
});

test('termination during acquisition cannot publish a worker or ready evidence afterward', async () => {
    const h = await harness({ holdAssets: true });
    const pending = h.engine.init();
    await new Promise(resolve => setImmediate(resolve));
    await h.engine.terminate();
    h.releaseAssets();
    assert.equal((await pending).isOk, false);
    assert.equal(h.workers.length, 0);
    assert.equal(h.engine.getRuntimeEvidence(), null);
});

test('a mismatched backend fails initialization and retires resources', async () => {
    const h = await harness({ backend: 'webgpu' });
    assert.equal((await h.engine.init()).isOk, false);
    assert.equal(h.engine.getRuntimeEvidence(), null);
    assert.equal(h.workers[0].terminated, true);
    assert.equal(h.urls.size, 0);
});

test('concurrent initializations do not let the older admission own the worker', async () => {
    const h = await harness();
    const first = h.engine.init();
    const second = h.engine.init();
    assert.equal((await first).isOk, false);
    assert.equal((await second).isOk, true);
    assert.equal(h.workers.length, 1);
    await h.engine.terminate();
});
