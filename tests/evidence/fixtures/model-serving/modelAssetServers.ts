/**
 * Shared fixture for the /models/ serving contract (release review of 1816ec61): the three local serving paths,
 * started on the repository's real configuration, each serving the same model files whose bytes are an HTML document
 * with an inline script. Used by tests/evidence/__tests__/modelAssetServing.test.ts (response headers) and
 * tests/e2e/model-asset-serving.e2e.spec.ts (browser navigation).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer, preview } from 'vite';
import { createE2eApp } from '../../../../scripts/serve-e2e.mjs';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const VITE_CONFIG = join(REPOSITORY_ROOT, 'frontend/vite.config.mjs');

/** HTML-shaped bytes: rendering this as a document runs the script and retitles the page. */
export const ACTIVE_MODEL_BYTES =
    '<!doctype html><title>model</title><script>document.title="EXECUTED";window.__modelAssetExecuted=1</script>';

/** One file per supported type, plus two types no package may carry, with the type each must be served as. */
export const MODEL_FIXTURE_FILES: Readonly<Record<string, string>> = Object.freeze({
    'fixture/encoder.onnx': 'application/octet-stream',
    'fixture/encoder.onnx.data': 'application/octet-stream',
    'fixture/weights.bin': 'application/octet-stream',
    'fixture/model.ort': 'application/octet-stream',
    'fixture/vocab.txt': 'text/plain; charset=utf-8',
    'fixture/config.json': 'application/json',
    'fixture/LICENSE': 'text/plain; charset=utf-8',
    'fixture/nested/source/NOTICE': 'text/plain; charset=utf-8',
    'fixture/runtime.mjs': 'text/javascript; charset=utf-8',
    'fixture/runtime.js': 'text/javascript; charset=utf-8',
    'fixture/ort.wasm': 'application/wasm',
    'fixture/stray.html': 'application/octet-stream',
    'fixture/stray.svg': 'application/octet-stream',
});

export type ModelAssetServer = { name: string; origin: string };
export type ModelAssetServers = { servers: ModelAssetServer[]; close: () => Promise<void> };

function writeFixture(modelsRoot: string) {
    for (const name of Object.keys(MODEL_FIXTURE_FILES)) {
        mkdirSync(join(modelsRoot, name, '..'), { recursive: true });
        writeFileSync(join(modelsRoot, name), ACTIVE_MODEL_BYTES);
    }
}

function originOf(address: AddressInfo | string | null) {
    if (!address || typeof address === 'string') throw Error('server did not bind a TCP port');
    return `http://127.0.0.1:${address.port}`;
}

/** Vite preview and Vite dev from frontend/vite.config.mjs, and the E2E server's real app, on ephemeral ports. */
export async function startModelAssetServers(): Promise<ModelAssetServers> {
    const distDir = mkdtempSync(join(tmpdir(), 'model-serving-dist-'));
    const publicDir = mkdtempSync(join(tmpdir(), 'model-serving-public-'));
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>app</title>');
    writeFixture(join(distDir, 'models'));
    writeFixture(join(publicDir, 'models'));
    const closers: Array<() => Promise<void>> = [];
    const servers: ModelAssetServer[] = [];
    const close = async () => {
        await Promise.allSettled(closers.map(closeServer => closeServer()));
        rmSync(distDir, { recursive: true, force: true });
        rmSync(publicDir, { recursive: true, force: true });
    };
    try {
        const vitePreview = await preview({
            configFile: VITE_CONFIG, logLevel: 'silent',
            build: { outDir: distDir }, preview: { host: '127.0.0.1', port: 0, strictPort: false },
        });
        closers.push(() => vitePreview.close());
        servers.push({ name: 'vite preview', origin: originOf(vitePreview.httpServer.address()) });

        const viteDev = await createServer({
            configFile: VITE_CONFIG, logLevel: 'silent', publicDir,
            server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null },
            optimizeDeps: { noDiscovery: true, include: [] },
        });
        closers.push(() => viteDev.close());
        await viteDev.listen();
        servers.push({ name: 'vite dev', origin: originOf(viteDev.httpServer!.address()) });

        const e2e: Server = await new Promise((done, fail) => {
            const server = createE2eApp(distDir).listen(0, '127.0.0.1', () => done(server)).on('error', fail);
        });
        closers.push(() => new Promise(done => { e2e.closeAllConnections(); e2e.close(() => done()); }));
        servers.push({ name: 'E2E server', origin: originOf(e2e.address()) });
    } catch (error) {
        await close();
        throw error;
    }
    return { servers, close };
}
