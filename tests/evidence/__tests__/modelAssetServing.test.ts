// @vitest-environment node
/**
 * Release review of 1816ec61 (P2): package admission keeps active document TYPES out of /models/, but an admitted model
 * file can still hold HTML-shaped bytes. The local preview served .onnx/.data/LICENSE with no Content-Type and no
 * nosniff, so a navigation sniffed and rendered that HTML on the application origin. Every serving path must give each
 * model response an explicit non-executable type and nosniff:
 *   - Vite preview and Vite dev, loaded from the real frontend/vite.config.mjs;
 *   - the E2E server's real app (scripts/serve-e2e.mjs);
 *   - production: vercel.json, evaluated with the matcher Vercel's routing uses (path-to-regexp 6, strict,
 *     case-sensitive), for the policy table and for every file the repository serves under /models/.
 * Browser navigation to the same fixtures is proven in tests/e2e/model-asset-serving.e2e.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { modelAssetHeaders } from '../../../scripts/lib/modelAssetHeaders.mjs';
import {
    ACTIVE_MODEL_BYTES, MODEL_FIXTURE_FILES, REPOSITORY_ROOT, startModelAssetServers, type ModelAssetServers,
} from '../fixtures/model-serving/modelAssetServers';

let running: ModelAssetServers;
beforeAll(async () => { running = await startModelAssetServers(); }, 120_000);
afterAll(async () => { await running?.close(); });
const originOf = (name: string) => running.servers.find(server => server.name === name)!.origin;

describe('the model asset serving policy', () => {
    it('gives every model path a non-executable type (or a reviewed runtime type) and nosniff', () => {
        for (const [name, type] of Object.entries(MODEL_FIXTURE_FILES)) {
            expect({ name, headers: modelAssetHeaders('/models/' + name) }).toEqual({ name, headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' } });
        }
        expect(modelAssetHeaders('/models/x/Vocab.TXT')?.['Content-Type']).toBe('text/plain; charset=utf-8');
        expect(modelAssetHeaders('/models/x/page%2Ehtml?download=1')?.['Content-Type']).toBe('application/octet-stream');
        expect(modelAssetHeaders('/models/x/%E0%A4%A.onnx')?.['Content-Type']).toBe('application/octet-stream');
        // A case-insensitive file system serves /MODELS/ as /models/.
        expect(modelAssetHeaders('/MODELS/x/model.onnx')?.['Content-Type']).toBe('application/octet-stream');
    });
    it('also covers other URLs that reach a guarded model directory (a dev server\'s root and /@fs/ routes)', () => {
        const guard = { root: '/srv/app', modelDirs: ['/srv/app/public/models'] };
        expect(modelAssetHeaders('/public/models/x/model.onnx', guard)?.['Content-Type']).toBe('application/octet-stream');
        expect(modelAssetHeaders('/PUBLIC/Models/x/LICENSE', guard)?.['Content-Type']).toBe('text/plain; charset=utf-8');
        expect(modelAssetHeaders('/@fs/srv/app/public/models/x/vocab.txt', guard)?.['Content-Type']).toBe('text/plain; charset=utf-8');
        expect(modelAssetHeaders('/@fs/srv/app/public/models/../models/x/a.ort', guard)?.['Content-Type']).toBe('application/octet-stream');
        expect(modelAssetHeaders('/public/favicon.ico', guard)).toBeNull();
        expect(modelAssetHeaders('/@fs/srv/app/src/main.tsx', guard)).toBeNull();
        expect(modelAssetHeaders('/public/models/x/model.onnx')).toBeNull();
    });
    it('applies to model paths only, after the same normalization the static servers use', () => {
        expect(modelAssetHeaders('/index.html')).toBeNull();
        expect(modelAssetHeaders('/assets/main-abc.js')).toBeNull();
        expect(modelAssetHeaders('/models/../index.html')).toBeNull();
        expect(modelAssetHeaders('/assets/../models/x/vocab.txt')?.['Content-Type']).toBe('text/plain; charset=utf-8');
    });
});

const served = (serverName: string) => running.servers.find(server => server.name === serverName)!;
describe.each(['vite preview', 'vite dev', 'E2E server'])('%s serves model assets as non-executable', serverName => {
    it.each(Object.entries(MODEL_FIXTURE_FILES))('%s, under every prefix that reaches it', async (name, type) => {
        const { origin, prefixes } = served(serverName);
        for (const prefix of prefixes) {
            const response = await fetch(`${origin}${prefix}${name}`);
            // Vite dev transforms what it serves from its root (a source-map comment, its HTML injections); the type and
            // nosniff are what keep those responses inert. /models/ is served byte for byte.
            const body = await response.text();
            expect({
                prefix, status: response.status, type: response.headers.get('content-type'),
                nosniff: response.headers.get('x-content-type-options'), exactBytes: body === ACTIVE_MODEL_BYTES || prefix !== '/models/',
            }).toEqual({ prefix, status: 200, type, nosniff: 'nosniff', exactBytes: true });
        }
    });
    it('never answers a missing model asset with an HTML document', async () => {
        const response = await fetch(`${originOf(serverName)}/models/fixture/missing.onnx`);
        expect(response.headers.get('content-type') ?? '').not.toMatch(/html/i);
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    });
    it('leaves application responses alone', async () => {
        const response = await fetch(`${originOf(serverName)}/`);
        expect(response.headers.get('content-type')).toMatch(/^text\/html/);
        expect(response.headers.get('x-content-type-options')).toBeNull();
    });
});

describe('production (vercel.json) applies the same policy', () => {
    type Rule = { source: string; headers: { key: string; value: string }[] };
    const rules = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'vercel.json'), 'utf8')).headers as Rule[];
    // Vercel's routing compiles each `source` with path-to-regexp 6 (strict, case-sensitive, '/' delimiter).
    const fromMsw = createRequire(createRequire(import.meta.url).resolve('msw/package.json'));
    const { pathToRegexp } = fromMsw('path-to-regexp') as { pathToRegexp: (s: string, k: unknown[], o: object) => RegExp };
    const compiled = rules.map(rule => ({ rule, regex: pathToRegexp(rule.source, [], { strict: true, sensitive: true, delimiter: '/' }) }));
    function effective(pathname: string) {
        const matched = compiled.filter(({ regex }) => regex.test(pathname)).flatMap(({ rule }) => rule.headers);
        return {
            types: matched.filter(h => h.key.toLowerCase() === 'content-type').map(h => h.value),
            nosniff: matched.some(h => h.key.toLowerCase() === 'x-content-type-options' && h.value === 'nosniff'),
        };
    }

    it("uses Vercel's matcher version", () => {
        expect((fromMsw('path-to-regexp/package.json') as { version: string }).version).toMatch(/^6\./);
    });
    it.each(Object.entries(MODEL_FIXTURE_FILES))('%s', (name, type) => {
        expect(effective('/models/' + name)).toEqual({ types: [type], nosniff: true });
    });
    it("covers every file the repository serves under /models/, with exactly the shared policy's type", () => {
        const modelsRoot = join(REPOSITORY_ROOT, 'frontend/public/models');
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) { const full = join(dir, entry); if (statSync(full).isDirectory()) walk(full); else files.push(full); }
        };
        walk(modelsRoot);
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const pathname = '/models/' + relative(modelsRoot, file).split('\\').join('/');
            expect({ pathname, ...effective(pathname) }).toEqual({ pathname, types: [modelAssetHeaders(pathname)!['Content-Type']], nosniff: true });
        }
    });
    it('gives any other extension, in any case, an opaque type', () => {
        for (const pathname of ['/models/x/page.html', '/models/x/y/icon.SVG', '/models/x/feed.xml', '/models/x/model.ONNX']) {
            expect({ pathname, ...effective(pathname) }).toEqual({ pathname, types: ['application/octet-stream'], nosniff: true });
        }
    });
    it('adds nothing to application paths', () => {
        for (const pathname of ['/', '/index.html', '/assets/main-abc.js', '/sw.js']) expect(effective(pathname)).toEqual({ types: [], nosniff: false });
    });
});
