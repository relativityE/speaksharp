import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = join(root, 'frontend/public/models/parakeet-runtime/1.4.4-ort1.24.1');
const source = join(directory, 'source');
const upstream = join(source, 'parakeet.js-1.4.4');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = JSON.parse(await readFile(join(source, 'source-hashes.json'), 'utf8'));
for (const [path, digest] of Object.entries(hashes)) {
    if (sha256(await readFile(join(upstream, path))) !== digest) throw new Error(`Changed upstream source: ${path}`);
}
const ortPins = JSON.parse(await readFile(join(source, 'ort-source-pins.json'), 'utf8'));
for (const pin of ortPins) {
    const bytes = await readFile(join(directory, pin.path));
    if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Changed ORT artifact: ${pin.path}`);
}

// This alias and ParakeetModel's relative import resolve to the identical backend.js
// module. Export its returned ORT instance, rather than importing the app's different ORT.
const entry = '\0speaksharp-parakeet-binding';
const result = await build({
    configFile: false, envFile: false, publicDir: false, root: source, logLevel: 'warn',
    resolve: { alias: {
        'onnxruntime-web': join(source, 'ort.wasm.bundle.min.mjs'),
        'speaksharp-parakeet-backend': join(upstream, 'src/backend.js'),
        'speaksharp-parakeet-model': join(upstream, 'src/parakeet.js'),
    } },
    // Published source stays byte-for-byte intact. Vendor console output is removed
    // from the delivered bundle so upstream debug paths cannot expose transcript text.
    esbuild: { drop: ['console'] },
    plugins: [{ name: 'speaksharp-parakeet-binding',
        resolveId(id) { if (id === entry) return entry; },
        load(id) {
            if (id === entry) return `
                import { ParakeetModel } from 'speaksharp-parakeet-model';
                import { initOrt } from 'speaksharp-parakeet-backend';
                import * as pinnedOrt from 'onnxruntime-web';
                const ort = await initOrt({ backend: 'wasm', numThreads: 1 });
                if (ort !== (pinnedOrt.default || pinnedOrt)) throw new Error('Runtime singleton mismatch');
                const bindingIdentity = Object.freeze({ package: 'parakeet.js', version: '1.4.4', ortVersion: '1.24.1' });
                export { ParakeetModel, ort, bindingIdentity };`;
        },
    }],
    build: { write: false, target: 'esnext', minify: 'esbuild', sourcemap: false, modulePreload: false,
        lib: { entry, formats: ['es'], fileName: 'parakeet-runtime' },
        rollupOptions: { input: entry, preserveEntrySignatures: 'strict',
            output: { format: 'es', inlineDynamicImports: true, entryFileNames: 'parakeet-runtime.mjs' } } },
});
const output = Array.isArray(result) && result.length === 1 ? result[0] : result;
if (!('output' in output) || output.output.length !== 1) throw new Error('Unexpected runtime outputs');
const chunk = output.output[0];
if (chunk.type !== 'chunk' || chunk.imports.length || chunk.dynamicImports.length) throw new Error('Runtime binding must be self-contained');
await writeFile(join(directory, 'parakeet-runtime.mjs'), chunk.code);
console.log(JSON.stringify({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code), sha256: sha256(chunk.code) }));
