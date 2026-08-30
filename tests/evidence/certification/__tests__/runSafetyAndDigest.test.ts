import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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
