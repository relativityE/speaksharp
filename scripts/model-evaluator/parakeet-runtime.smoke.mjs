import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Native browser/runtime smoke only. Identity ONNX graphs are deliberately tiny;
// this does not claim recognition quality or qualification of Parakeet weights.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pins = JSON.parse(await readFile(join(root, 'frontend/src/services/transcription/engines/parakeet/assetPins.json'), 'utf8'));
const directory = join(root, 'frontend/public/models/parakeet-runtime/1.4.4-ort1.24.1');
const allowed = new Set(['parakeet-runtime.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']);
for (const pin of pins.files.filter(file => allowed.has(file.path))) {
    const bytes = await readFile(join(directory, pin.path));
    assert.equal(bytes.length, pin.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256);
}
const server = createServer((request, response) => {
    const name = request.url?.slice(1);
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Runtime smoke</title>'); return; }
    if (!allowed.has(name)) { response.writeHead(404); response.end(); return; }
    void readFile(join(directory, name)).then(bytes => {
        response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        response.end(bytes);
    }, () => { response.writeHead(500); response.end(); });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
assert(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    const context = await browser.newContext();
    const requests = [];
    await context.route('**/*', route => {
        const url = route.request().url();
        if (!url.startsWith(`${origin}/`)) return route.abort();
        requests.push(new URL(url).pathname);
        return route.continue();
    });
    const page = await context.newPage();
    await page.goto(origin);
    const result = await page.evaluate(async () => {
        const runNative = async () => {
        const bytes = async name => new Uint8Array(await (await fetch(new URL(`/${name}`, self.location.origin))).arrayBuffer());
        const blobUrl = (value, type) => URL.createObjectURL(new Blob([value], { type }));
        const urls = [];
        try {
            const runtimeUrl = blobUrl(await bytes('parakeet-runtime.mjs'), 'text/javascript'); urls.push(runtimeUrl);
            const runtime = await import(runtimeUrl);
            if (runtime.ort.env.versions.common !== '1.24.1') throw new Error('Wrong native runtime');
            const glue = blobUrl(await bytes('ort-wasm-simd-threaded.mjs'), 'text/javascript'); urls.push(glue);
            const wasm = blobUrl(await bytes('ort-wasm-simd-threaded.wasm'), 'application/wasm'); urls.push(wasm);
            runtime.ort.env.wasm.wasmPaths = { mjs: glue, wasm };
            runtime.ort.env.wasm.numThreads = 1;
            runtime.ort.env.wasm.proxy = false;
            // Minimal ONNX ModelProto: float[1] Identity, IR8, opset13.
            const varint = value => { const out = []; do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; out.push(byte); } while (value); return out; };
            const field = (id, value) => [(id << 3) | 2, ...varint(value.length), ...value];
            const text = (id, value) => field(id, [...new TextEncoder().encode(value)]);
            const info = name => [...text(1, name), ...field(2, field(1, [8, 1, ...field(2, field(1, [8, 1]))]))];
            const graph = [...field(1, [...text(1, 'x'), ...text(2, 'y'), ...text(4, 'Identity')]),
                ...text(2, 'runtime_smoke'), ...field(11, info('x')), ...field(12, info('y'))];
            const modelBytes = new Uint8Array([8, 8, ...field(7, graph), ...field(8, [16, 13])]);
            const session = await runtime.ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
            const output = await session.run({ x: new runtime.ort.Tensor('float32', new Float32Array([42]), [1]) });
            if (output.y.data[0] !== 42) throw new Error('Native WASM Identity inference failed');
            const modelUrl = blobUrl(modelBytes, 'application/octet-stream'); urls.push(modelUrl);
            const vocabUrl = blobUrl('a 0\nb 1\n<blk> 2\n', 'text/plain'); urls.push(vocabUrl);
            const model = await runtime.ParakeetModel.fromUrls({ encoderUrl: modelUrl, decoderUrl: modelUrl,
                tokenizerUrl: vocabUrl, backend: 'wasm', cpuThreads: 1, preprocessorBackend: 'js',
                nMels: 128, subsampling: 8, windowStride: 0.01, enableGraphCapture: false });
            if (model.ort !== runtime.ort) throw new Error('Published fromUrls used another ORT instance');
            const features = await model.computeFeatures(new Float32Array(1600), 16000);
            if (features.melBins !== 128 || !features.features.every(Number.isFinite)) throw new Error('Native JS frontend failed');
            return { binding: runtime.bindingIdentity, nativeIdentityOutput: output.y.data[0],
                sameOrtInstance: model.ort === runtime.ort, melBins: features.melBins,
                weightQualification: false };
        } finally { urls.forEach(url => URL.revokeObjectURL(url)); }
        };
        const workerUrl = URL.createObjectURL(new Blob([
            `(${runNative.toString()})().then(value => postMessage({ ok: true, value })).catch(error => postMessage({ ok: false, error: error.stack }));`,
        ], { type: 'text/javascript' }));
        const worker = new Worker(workerUrl, { type: 'module' });
        try {
            return await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Native runtime smoke timed out')), 30000);
                worker.onmessage = ({ data }) => { clearTimeout(timer); data.ok ? resolve(data.value) : reject(new Error(data.error)); };
                worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
            });
        } finally { worker.terminate(); URL.revokeObjectURL(workerUrl); }
    });
    console.log(JSON.stringify({ ok: true, ...result, networkPaths: requests }));
} finally {
    await browser?.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
