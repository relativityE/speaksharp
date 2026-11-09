/**
 * Release review of 1816ec61 (P2): navigating to a model file whose bytes are an HTML document must never render or run
 * it on the application origin. Each local serving path (Vite preview and Vite dev from the real config, and the E2E
 * server's real app) serves the same fixture; the browser must either download the file or show it as text/data, and
 * the inline script must not run. Response headers, and production's vercel.json, are covered in
 * tests/evidence/__tests__/modelPackageImport.test.ts.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createServer, preview } from 'vite';
import { createE2eApp } from '../../scripts/serve-e2e.mjs';

// Serving fixture: the same one tests/evidence/__tests__/modelPackageImport.test.ts uses for response headers.
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VITE_CONFIG = join(REPOSITORY_ROOT, 'frontend/vite.config.mjs');

/** HTML-shaped bytes: rendering this as a document runs the script and retitles the page. */
const ACTIVE_MODEL_BYTES =
    '<!doctype html><title>model</title><script>document.title="EXECUTED";window.__modelAssetExecuted=1</script>';

/** One file per supported type, plus two types no package may carry, with the type each must be served as. */
const MODEL_FIXTURE_FILES: Readonly<Record<string, string>> = Object.freeze({
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

/**
 * `prefixes` are every URL prefix the server answers with the model files: `/models/` everywhere, and on Vite dev also
 * its root-relative `/public/models/` and its absolute-path `/@fs/.../public/models/` (independent review of d8753964).
 */
type ModelAssetServer = { name: string; origin: string; prefixes: string[] };
type ModelAssetServers = { servers: ModelAssetServer[]; close: () => Promise<void> };

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
async function startModelAssetServers(): Promise<ModelAssetServers> {
    const distDir = realpathSync(mkdtempSync(join(tmpdir(), 'model-serving-dist-')));
    // The dev server gets its own root holding public/, laid out like frontend/ (root) and frontend/public (publicDir).
    const devRoot = realpathSync(mkdtempSync(join(tmpdir(), 'model-serving-root-')));
    const publicDir = join(devRoot, 'public');
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>app</title>');
    writeFileSync(join(devRoot, 'index.html'), '<!doctype html><title>app</title>');
    writeFixture(join(distDir, 'models'));
    writeFixture(join(publicDir, 'models'));
    const closers: Array<() => Promise<void>> = [];
    const servers: ModelAssetServer[] = [];
    const close = async () => {
        await Promise.allSettled(closers.map(closeServer => closeServer()));
        rmSync(distDir, { recursive: true, force: true });
        rmSync(devRoot, { recursive: true, force: true });
    };
    try {
        const vitePreview = await preview({
            configFile: VITE_CONFIG, logLevel: 'silent',
            build: { outDir: distDir }, preview: { host: '127.0.0.1', port: 0, strictPort: false },
        });
        closers.push(() => vitePreview.close());
        servers.push({ name: 'vite preview', origin: originOf(vitePreview.httpServer.address()), prefixes: ['/models/'] });

        const viteDev = await createServer({
            configFile: VITE_CONFIG, logLevel: 'silent', root: devRoot, publicDir,
            server: { host: '127.0.0.1', port: 0, strictPort: false, watch: null, fs: { allow: [devRoot] } },
            optimizeDeps: { noDiscovery: true, include: [] },
        });
        closers.push(() => viteDev.close());
        await viteDev.listen();
        servers.push({
            name: 'vite dev', origin: originOf(viteDev.httpServer!.address()),
            prefixes: ['/models/', '/public/models/', `/@fs${publicDir}/models/`],
        });

        const e2e: Server = await new Promise((done, fail) => {
            const server = createE2eApp(distDir).listen(0, '127.0.0.1', () => done(server)).on('error', fail);
        });
        closers.push(() => new Promise(done => { e2e.closeAllConnections(); e2e.close(() => done()); }));
        servers.push({ name: 'E2E server', origin: originOf(e2e.address()), prefixes: ['/models/'] });
    } catch (error) {
        await close();
        throw error;
    }
    return { servers, close };
}


const DOCUMENT_TYPES = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)/i;

let running: ModelAssetServers;
test.beforeAll(async () => { running = await startModelAssetServers(); });
test.afterAll(async () => { await running?.close(); });

// No app, login or MSW context is involved: each test opens a raw model-file URL on a bare server, so a direct
// navigation is the behaviour under test.
async function navigate(tab: Page, url: string) {
    let executedInDialog = false;
    tab.on('dialog', dialog => { executedInDialog = true; void dialog.dismiss(); });
    try {
        await tab.goto(url, { waitUntil: 'load' });
    } catch (error) {
        // An opaque type is handed to the download manager instead of being rendered.
        if (/Download is starting/i.test(String(error))) return { rendered: false as const };
        throw error;
    }
    const state = await tab.evaluate(() => ({
        contentType: document.contentType,
        title: document.title,
        executed: (window as unknown as { __modelAssetExecuted?: number }).__modelAssetExecuted === 1,
        scripts: document.scripts.length,
    }));
    return { rendered: true as const, executedInDialog, ...state };
}

for (const serverName of ['vite preview', 'vite dev', 'E2E server']) {
    test.describe(`${serverName}: navigating to a model file never runs it as a document`, () => {
        for (const name of Object.keys(MODEL_FIXTURE_FILES)) {
            test(name, async ({ page }) => {
                const { origin, prefixes } = running.servers.find(server => server.name === serverName)!;
                for (const prefix of prefixes) {
                    const result = await navigate(page, `${origin}${prefix}${name}`);
                    if (!result.rendered) continue;
                    expect({ prefix, ...result }).toMatchObject({ prefix, executed: false, executedInDialog: false, scripts: 0 });
                    expect(result.contentType).not.toMatch(DOCUMENT_TYPES);
                    expect(result.title).not.toBe('EXECUTED');
                }
            });
        }
    });
}
