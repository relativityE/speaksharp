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

/**
 * #1304 — the SERIALIZED EVIDENCE must agree with itself, and the fingerprint must bind the runtime.
 *
 * THE DEFECT THIS CLOSES. The asset object was built TWICE — once for the arm's provenance and once
 * for the verdict's footprint — and the runtime binaries were added to the second only. The v4 fp32
 * artifact then reported 9 files in its footprint, 7 in its certification provenance and 7 in its
 * top-level count: three numbers for one fact. The two missing files were the runtime binaries, so
 * the certificate fingerprint bound the model weights but NOT the bytes that executed them, and a
 * runtime could change without moving it.
 *
 * These are unit-level because the wiring is what failed, not the loading.
 */
import { fingerprintConfiguration, fingerprintDifferences } from '../fingerprint';
import { buildTechnicalVerdict } from '../buildVerdict';
import type { ArmProvenance } from '../engineArm';
import type { ArmRunResult } from '../runArm';
import type { AssetRecord } from '../browser/server';

const RUNTIME_FILE = 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm';

const assetSet = (over: Record<string, AssetRecord> = {}): Record<string, AssetRecord> => ({
    'onnx/encoder_model.onnx': { sha256: 'a'.repeat(64), bytes: 100, source: 'cache', pinned: true },
    'onnx/decoder_model.onnx': { sha256: 'b'.repeat(64), bytes: 200, source: 'cache', pinned: true },
    [RUNTIME_FILE]: { sha256: 'c'.repeat(64), bytes: 300, source: 'cache', pinned: true },
    ...over,
});

const provenanceFrom = (assets: Record<string, AssetRecord>): ArmProvenance => ({
    model: {
        id: 'm', revision: 'r',
        filesSha256: Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, v.sha256])),
    },
    runtime: { library: 'l', version: '1.0.0', backend: 'wasm' },
    assets: { source: 's', verdict: 'identical' },
    device: { platform: 'p', arch: 'a', cpuModel: 'c', cores: 1 },
    route: { hash: 'h', route: { family: 'moonshine', modelId: 'm', rawWaveform: true, maxPositionEmbeddings: 512, returnTimestamps: false, maxNewTokens: 10 } },
    corpus: { version: 'v', digest: 'd'.repeat(64), archives: { a: 'b' } },
    resources: { wallClockMs: 1, peakRssBytes: null },
});

const runResult = (assets: Record<string, AssetRecord>): ArmRunResult => ({
    ok: true,
    row: {
        armId: 'arm', rulesVersion: 'cert_v1', track: 'track_a', aggregation: 'pooled',
        wer: 0.05, referenceWords: 100, substitutions: 3, deletions: 1, insertions: 1, scoredCount: 10,
        provenance: provenanceFrom(assets), fingerprint: 'x',
    },
    scores: [], aggregate: { wer: 0.05, referenceWords: 100, substitutions: 3, deletions: 1, insertions: 1, scoredCount: 10, invalidCount: 0, invalidReasons: {} },
    decodeFailures: [], clipOutcomes: [],
});

describe('one asset object, one set of numbers', () => {
    it('the verdict footprint count equals the provenance file count', () => {
        const assets = assetSet();
        const verdict = buildTechnicalVerdict({
            armId: 'arm', runtimeLabel: 'rt', evidenceSet: 'corpus', evidenceClass: 'selection',
            result: runResult(assets), coldLoadMs: 1, stopToFinalMs: null, backendProven: true,
            resolvedBackend: 'wasm', hardwareRepresentative: true, transcriptDigest: 't',
            fingerprint: 'f', assets, expectedClips: 10, audioRejected: 0,
        });
        const provenanceFiles = Object.keys(runResult(assets).ok
            ? provenanceFrom(assets).model.filesSha256 : {}).length;
        expect(verdict.footprint.assetCount).toBe(provenanceFiles);
        expect(verdict.assetDigestCount).toBe(provenanceFiles);
    });

    it('provenance CONTAINS the runtime binaries actually served', () => {
        // The two files that went missing. A v4 arm fetches them, so they belong in the record of what
        // ran, not only in the download total.
        const provenance = provenanceFrom(assetSet());
        expect(Object.keys(provenance.model.filesSha256)).toContain(RUNTIME_FILE);
    });

    it('the footprint total INCLUDES the runtime bytes', () => {
        const assets = assetSet();
        const verdict = buildTechnicalVerdict({
            armId: 'arm', runtimeLabel: 'rt', evidenceSet: 'corpus', evidenceClass: 'selection',
            result: runResult(assets), coldLoadMs: 1, stopToFinalMs: null, backendProven: true,
            resolvedBackend: 'wasm', hardwareRepresentative: true, transcriptDigest: 't',
            fingerprint: 'f', assets, expectedClips: 10, audioRejected: 0,
        });
        expect(verdict.footprint.modelBytes).toBe(600); // 100 + 200 + 300
    });
});

describe('the fingerprint binds the runtime bytes', () => {
    it('CHANGING a runtime digest moves the fingerprint', () => {
        // Before the fix a runtime binary could change without the fingerprint moving, because it was
        // never in the provenance the fingerprint is computed from.
        const before = fingerprintConfiguration('arm', provenanceFrom(assetSet()), 'none');
        const after = fingerprintConfiguration(
            'arm',
            provenanceFrom(assetSet({ [RUNTIME_FILE]: { sha256: 'f'.repeat(64), bytes: 300, source: 'cache', pinned: true } })),
            'none',
        );
        expect(after.digest).not.toBe(before.digest);
        expect(fingerprintDifferences(before, after)).toContain('weights');
    });

    it('REMOVING a runtime binary moves the fingerprint too', () => {
        const full = assetSet();
        const without = { ...full };
        delete without[RUNTIME_FILE];
        const a = fingerprintConfiguration('arm', provenanceFrom(full), 'none');
        const b = fingerprintConfiguration('arm', provenanceFrom(without), 'none');
        expect(b.digest).not.toBe(a.digest);
    });

    it('an unrelated model file changing still moves it — the binding is not runtime-only', () => {
        const a = fingerprintConfiguration('arm', provenanceFrom(assetSet()), 'none');
        const b = fingerprintConfiguration('arm', provenanceFrom(assetSet({
            'onnx/encoder_model.onnx': { sha256: 'e'.repeat(64), bytes: 100, source: 'cache', pinned: true },
        })), 'none');
        expect(b.digest).not.toBe(a.digest);
    });
});
