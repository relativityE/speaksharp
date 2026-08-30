import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildAssetInventory, reconcileAssets } from '../assetInventory';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../../../../scripts/run-browser-matrix.mts'), 'utf8');
const PINS = JSON.parse(readFileSync(resolve(__dirname, '../../../fixtures/lib-executable-pins.json'), 'utf8')) as {
    assets: Record<string, { sha256: string; bytes: number; package: string; version: string }>;
};

describe('#1304 C — assetDigest binds the bytes that EXECUTE', () => {
    it('includes the lib executable pins', () => {
        // r3 and r4 carried the SAME assetDigest while their executable inventories differed, so a partial
        // run could resume across a change to the code that actually runs.
        const block = SRC.slice(SRC.indexOf('assetDigest: digestOfFiles('), SRC.indexOf(']', SRC.indexOf('assetDigest: digestOfFiles(')));
        expect(block).toContain('lib-executable-pins.json');
        expect(block).toContain('hf-asset-pins.json');
        expect(block).toContain('moonshine-asset-pins.json');
    });

    it('every pin binds package AND locked version AND digest — not just bytes', () => {
        const entries = Object.entries(PINS.assets);
        expect(entries.length).toBeGreaterThan(0);
        for (const [, v] of entries) {
            expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(v.version).toMatch(/@\d/);          // e.g. onnxruntime-web@1.27.0
            expect(v.bytes).toBeGreaterThan(0);
        }
    });

    it('the modules the preflight actually observed are pinned', () => {
        const names = Object.keys(PINS.assets);
        for (const want of ['ort.webgpu.bundle.min.mjs', 'moonshine.mjs', 'moonshine.wasm']) {
            expect(names.some((n) => n.endsWith(want)), `${want} is not pinned`).toBe(true);
        }
    });
});

describe('#1304 E — a multi-hour run cannot be trampled or spliced', () => {
    it('reserves the output path EXCLUSIVELY, and refuses rather than sharing it', () => {
        expect(SRC).toContain("flag: 'wx'");
        expect(SRC).toContain('REFUSING to start');
    });

    it('releases the lock on signals, not only on a clean exit', () => {
        // A run killed with Ctrl-C would otherwise leave a lock nobody can distinguish from a live one.
        expect(SRC).toContain("for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']");
        expect(SRC).toContain("process.on('exit', release)");
    });

    it('binds resume to a host fingerprint, and records it in the checkpoint', () => {
        // Timings are host-dependent; resuming on a different machine splices two populations into one
        // table that reads as a single experiment.
        expect(SRC).toContain('const hostFingerprint = createHash');
        expect(SRC).toContain('hostFingerprint,');
        expect(SRC).toContain('host fingerprint');
    });

    it('the fingerprint covers platform, arch, cores and the browser driver', () => {
        const block = SRC.slice(SRC.indexOf('const hostFingerprint = createHash'), SRC.indexOf('.digest(', SRC.indexOf('const hostFingerprint = createHash')));
        for (const field of ['platform', 'arch', 'cpuCores', 'playwright']) expect(block).toContain(field);
    });
});

describe('#1304 A — onnxruntime-common, the gap only int8 exposed', () => {
    // The first int8 preflight executed 19 unpinned onnxruntime-common ESM modules. The generator covered
    // onnxruntime-web but not onnxruntime-common, and the q4 arm never loads them — so the gap was
    // invisible until int8 ran. That is exactly why int8 belonged in the preflight.
    const common = Object.entries(PINS.assets).filter(([k]) => k.includes('onnxruntime-common'));

    it('POSITIVE CONTROL: the int8 modules are pinned with package AND locked version AND digest', () => {
        expect(common.length).toBeGreaterThanOrEqual(19);
        for (const [, v] of common) {
            expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(v.version).toMatch(/^onnxruntime-common@\d+\.\d+\.\d+/);
            expect(v.bytes).toBeGreaterThan(0);
        }
    });

    it('every module named in the failing int8 preflight is now covered', () => {
        const names = common.map(([k]) => k.split('/').pop());
        for (const want of [
            'tensor-impl.js', 'tensor-factory-impl.js', 'inference-session-impl.js',
            'tensor-conversion-impl.js', 'backend-impl.js', 'tensor-impl-type-mapping.js',
            'tensor-utils-impl.js', 'trace.js', 'index.js', 'env-impl.js', 'inference-session.js',
            'tensor.js', 'version.js', 'env.js', 'backend.js', 'tensor-conversion.js',
            'tensor-factory.js', 'onnx-model.js', 'onnx-value.js',
        ]) {
            expect(names, `${want} is still unpinned`).toContain(want);
        }
    });

    it('the generator covers onnxruntime-common, so a regenerate cannot silently drop it', () => {
        const gen = readFileSync(resolve(__dirname, '../../../../scripts/generate-lib-executable-pins.mts'), 'utf8');
        expect(gen).toContain("'onnxruntime-common/dist'");
    });

    it('CASUALTY: removing ONE onnxruntime-common pin makes the arm ineligible', () => {
        // Simulates a dependency bump that adds a module nobody pinned.
        const [victimKey, victim] = common[0];
        const declared = Object.fromEntries([
            ['x/onnx/encoder_model.onnx', { sha256: 'a'.repeat(64), bytes: 10, source: 'cache' as const, pinned: true }],
            ['x/onnx/decoder_model.onnx', { sha256: 'b'.repeat(64), bytes: 10, source: 'cache' as const, pinned: true }],
            ['x/tokenizer.json', { sha256: 'c'.repeat(64), bytes: 10, source: 'cache' as const, pinned: true }],
            // present in the inventory, absent from the registry → pinned:false, exactly as the server records it
            [victimKey, { sha256: victim.sha256, bytes: victim.bytes, source: 'cache' as const, pinned: false }],
        ]);
        const r = reconcileAssets(buildAssetInventory(declared, null), {}, { requirePinned: true });
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('unpinned_asset');
        expect(r.failures.some((f) => f.detail === victimKey)).toBe(true);
    });

    it('POSITIVE CONTROL: the same module PINNED reconciles cleanly', () => {
        const [k, v] = common[0];
        const declared = Object.fromEntries([
            ['x/onnx/encoder_model.onnx', { sha256: 'a'.repeat(64), bytes: 10, source: 'cache' as const, pinned: true }],
            ['x/onnx/decoder_model.onnx', { sha256: 'b'.repeat(64), bytes: 10, source: 'cache' as const, pinned: true }],
            ['x/tokenizer.json', { sha256: 'c'.repeat(64), bytes: 10, source: 'cache' as const, pinned: true }],
            [k, { sha256: v.sha256, bytes: v.bytes, source: 'cache' as const, pinned: true }],
        ]);
        expect(reconcileAssets(buildAssetInventory(declared, null), {}, { requirePinned: true }).ok).toBe(true);
    });
});
