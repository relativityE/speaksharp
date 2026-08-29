/**
 * #1304 — every runtime BYTE ACTUALLY SERVED must be pinned, proven against the real server.
 *
 * THE BYPASS THIS CLOSES, and it was mine. Having found both runtimes fetching their WASM from a CDN,
 * I redirected `wasmPaths` to `${origin}/lib/…`. Offline enforcement intercepts EXTERNAL requests
 * only, so a same-origin `/lib/` fetch is not checked at all: I moved the download from a blocked CDN
 * to my own unverified static mount. The request stopped failing; it never started being verified.
 *
 * Reproduced before fixing — an explicitly unpinned file, on the pinned/offline server:
 *
 *     200   9,223,228 bytes   /lib/@xenova/transformers/dist/ort-wasm.wasm      assetFailures: 0
 *
 * The previous test could not have caught this. It verified that files listed in a hand-maintained
 * table existed on disk — a question about the list, not about what the server hands out. These start
 * the REAL server and ask what actually comes back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarnessServer, type HarnessServer } from '../browser/server';
import { RUNTIME_ASSET_PINS } from '../arms/runtimeAssets';

const PINNED_V2 = 'node_modules/@xenova/transformers/dist/ort-wasm-simd-threaded.wasm';
const UNPINNED_V2 = 'ort-wasm.wasm'; // exists on disk, deliberately absent from the pin table

let harness: HarnessServer;
beforeAll(async () => {
    harness = await startHarnessServer(process.cwd(), {
        mode: 'pinned', offlineOnly: true, pins: {}, runtimePins: RUNTIME_ASSET_PINS,
    });
});
afterAll(async () => { await harness.close(); });

const get = async (path: string) => {
    const response = await fetch(`${harness.origin}${path}`);
    const body = response.ok ? (await response.arrayBuffer()).byteLength : 0;
    return { status: response.status, bytes: body };
};

describe('the pin-enforcing runtime endpoint', () => {
    it('serves a PINNED runtime binary', () => expect(
        get('/runtime/xenova/ort-wasm-simd-threaded.wasm'),
    ).resolves.toMatchObject({ status: 200 }));

    it('an UNPINNED filename returns NO BYTES and a named failure', async () => {
        // The precondition: the file genuinely exists on disk, so this is a refusal by policy rather
        // than a 404 by accident.
        const result = await get(`/runtime/xenova/${UNPINNED_V2}`);
        expect(result.bytes).toBe(0);
        expect(result.status).toBe(403);
        expect(harness.runtimeFailures.some((f) => f.reason === 'runtime_asset_unpinned')).toBe(true);
    });

    it('an unknown runtime FAMILY is refused', async () => {
        const result = await get('/runtime/somewhere-else/ort-wasm.wasm');
        expect(result.bytes).toBe(0);
        expect(result.status).toBe(403);
    });

    it('a path escaping the runtime root is refused', async () => {
        const result = await get('/runtime/xenova/../../../package.json');
        expect(result.bytes).toBe(0);
    });

    it('the generic /lib/ mount NO LONGER serves runtime binaries', async () => {
        // The exact bypass, as a test. Before the fix this returned 200 and 9,223,228 bytes with the
        // server reporting zero failures.
        const unpinned = await get(`/lib/@xenova/transformers/dist/${UNPINNED_V2}`);
        expect(unpinned.bytes).toBe(0);
        expect(unpinned.status).toBe(403);

        // And a PINNED binary is refused there too — the route, not the file, is what makes it
        // verifiable. Otherwise `wasmPaths` could be pointed back at `/lib/` and silently unchecked.
        const pinned = await get('/lib/@xenova/transformers/dist/ort-wasm-simd-threaded.wasm');
        expect(pinned.bytes).toBe(0);
        expect(pinned.status).toBe(403);
    });

    it('/lib/ still serves library CODE — the restriction is scoped, not a blanket ban', async () => {
        const code = await get('/lib/@xenova/transformers/dist/transformers.js');
        expect(code.status).toBe(200);
        expect(code.bytes).toBeGreaterThan(0);
    });

    it('records exactly what it served, and only what was requested', async () => {
        const capture = harness.beginRuntimeCapture();
        await get('/runtime/xenova/ort-wasm-simd-threaded.wasm');
        const served = capture();
        // ORT Web ships eight binaries totalling 79.8 MB; an arm fetches only the subset its backend
        // selects. Recording the whole table would overstate every arm's first-run cost.
        expect(Object.keys(served)).toEqual([PINNED_V2]);
        expect(served[PINNED_V2].pinned).toBe(true);
        expect(served[PINNED_V2].bytes).toBeGreaterThan(0);
    });

    it('a runtime binary whose pin does not match is refused', async () => {
        const tampered = await startHarnessServer(process.cwd(), {
            mode: 'pinned', offlineOnly: true, pins: {},
            runtimePins: { [PINNED_V2]: 'a'.repeat(64) },
        });
        try {
            const response = await fetch(`${tampered.origin}/runtime/xenova/ort-wasm-simd-threaded.wasm`);
            expect(response.status).toBe(403);
            expect(tampered.runtimeFailures[0]?.reason).toBe('runtime_asset_digest_mismatch');
        } finally {
            await tampered.close();
        }
    });

    it('REMOVING a runtime pin prevents the binary being served at all', async () => {
        // The falsification: with no binding there is nothing to verify against, so nothing is served
        // and no measurement can be taken with it.
        const unbound = await startHarnessServer(process.cwd(), {
            mode: 'pinned', offlineOnly: true, pins: {}, runtimePins: {},
        });
        try {
            const response = await fetch(`${unbound.origin}/runtime/xenova/ort-wasm-simd-threaded.wasm`);
            expect(response.status).toBe(403);
            expect(unbound.runtimeFailures[0]?.reason).toBe('runtime_asset_unpinned');
        } finally {
            await unbound.close();
        }
    });
});
