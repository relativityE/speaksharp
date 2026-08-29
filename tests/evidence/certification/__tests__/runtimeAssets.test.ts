/**
 * #1304 — THE RUNTIME BINARY IS AN ASSET, and every admitted arm must be able to load with the
 * network prohibited.
 *
 * THE DEFECT THIS CLOSES. The pin manifests covered model WEIGHTS. They did not cover the WebAssembly
 * build that executes them, so `@xenova/transformers` reached for
 * `https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/ort-wasm-simd-threaded.wasm` at load
 * time. Under offline enforcement every v2 arm was refused as `unpinned` and produced no WER.
 *
 * The enforcement was right. The omission was mine, and so was the reason it went unnoticed: I added
 * external blocking in the last commit before merge and re-ran only the Streaming arms under it, so no
 * v2 arm was ever exercised against the rule that broke it. A test that asks "can EVERY admitted arm
 * load offline?" would have caught it the moment the rule landed — which is what this is.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RUNTIME_ASSET_PINS, runtimeAssetsFor, verifyRuntimeAsset } from '../arms/runtimeAssets';
import { ADMITTED_ARMS } from '../arms/registry';

describe('every admitted arm can load with the network prohibited', () => {
    it.each(ADMITTED_ARMS.map((a) => [a.id, a] as const))(
        '%s has every runtime asset present and pinned',
        (_id, arm) => {
            // The clean-workspace question, asked per arm: is every byte this arm needs at load time
            // either self-hosted or committed? An arm that answers "no" cannot run offline, and will
            // be refused rather than measured.
            for (const path of runtimeAssetsFor(arm.runtime)) {
                const verified = verifyRuntimeAsset(path);
                expect(verified.ok, `${arm.id} runtime asset ${path}: ${verified.ok ? '' : verified.reason}`)
                    .toBe(true);
            }
        },
    );

    it('every transformers.js family declares runtime binaries; only moonshine-wasm ships its own', () => {
        // THIS ASSERTION USED TO SAY THE OPPOSITE, and the clean-workspace check above refuted it
        // within a minute of being written: I asserted that v4 and Moonshine bundled their ONNX
        // Runtime and fetched nothing, then every one of those arms was refused for three unpinned
        // `cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-*` files.
        //
        // A test that encodes a belief tests the belief. This one now encodes an observation.
        expect(runtimeAssetsFor('v2')).toEqual([
            'node_modules/@xenova/transformers/dist/ort-wasm-simd-threaded.wasm',
        ]);
        expect(runtimeAssetsFor('v4').length).toBeGreaterThan(0);
        expect(runtimeAssetsFor('v4').every((p) => p.includes('onnxruntime-web'))).toBe(true);
        // `moonshine` non-streaming loads through @huggingface/transformers, so it needs the same set.
        expect(runtimeAssetsFor('moonshine')).toEqual(runtimeAssetsFor('v4'));
        // `moonshine-wasm` genuinely ships `moonshine.wasm` inside the package we serve — verified by
        // observing it load with zero external fetches, not by assuming it.
        expect(runtimeAssetsFor('moonshine-wasm')).toEqual([]);
    });

    it('the v2 and v4 runtime binaries are DIFFERENT packages, and both are pinned', () => {
        // The defect appeared twice because two independent libraries each default `wasmPaths` to a
        // CDN. Pinning one taught nothing about the other.
        const v2 = runtimeAssetsFor('v2');
        const v4 = runtimeAssetsFor('v4');
        expect(v2.some((p) => p.includes('@xenova'))).toBe(true);
        expect(v4.some((p) => p.includes('@xenova'))).toBe(false);
        for (const path of [...v2, ...v4]) {
            expect(RUNTIME_ASSET_PINS[path], `${path} is unpinned`).toMatch(/^[0-9a-f]{64}$/);
        }
    });

    it('the committed digest is the digest of the installed file', () => {
        const path = 'node_modules/@xenova/transformers/dist/ort-wasm-simd-threaded.wasm';
        expect(existsSync(path)).toBe(true);
        const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
        expect(RUNTIME_ASSET_PINS[path]).toBe(actual);
        expect(actual).toMatch(/^ac23f2f3/);
    });
});

describe('a runtime asset fails CLOSED, for a named reason', () => {
    it('an UNLISTED path is refused rather than skipped', () => {
        // The whole defect was an asset nobody had listed. "Not in the table" must be a failure, or
        // the next unlisted runtime binary repeats it exactly.
        const result = verifyRuntimeAsset('node_modules/@xenova/transformers/dist/ort-wasm.wasm');
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe('runtime_asset_unpinned');
    });

    it('a MISSING pinned file is named, not thrown', () => {
        const pins = RUNTIME_ASSET_PINS;
        const missing = 'node_modules/@xenova/transformers/dist/does-not-exist.wasm';
        pins[missing] = 'a'.repeat(64);
        try {
            const result = verifyRuntimeAsset(missing);
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.reason).toBe('runtime_asset_missing');
        } finally {
            delete pins[missing];
        }
    });

    it('a CHANGED binary fails on its digest', () => {
        // Point a pin at a real file with the wrong expected digest: the same shape as a tampered or
        // partially-written runtime.
        const pins = RUNTIME_ASSET_PINS;
        const path = 'node_modules/@xenova/transformers/dist/ort-wasm-simd.wasm';
        pins[path] = 'b'.repeat(64);
        try {
            const result = verifyRuntimeAsset(path);
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.reason).toBe('runtime_asset_digest_mismatch');
            expect(result.detail).toContain('b'.repeat(64));
        } finally {
            delete pins[path];
        }
    });

    it('REMOVING the binding reproduces the original defect — and fails', () => {
        // The falsification the PO asked for: drop the binding and the arm can no longer prove its
        // runtime. Before this file existed, that state produced a CDN fetch and a refused arm with a
        // bare "unpinned" against a URL nobody recognised.
        const pins = RUNTIME_ASSET_PINS;
        const path = 'node_modules/@xenova/transformers/dist/ort-wasm-simd-threaded.wasm';
        const saved = pins[path];
        delete pins[path];
        try {
            const result = verifyRuntimeAsset(path);
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.reason).toBe('runtime_asset_unpinned');
        } finally {
            pins[path] = saved;
        }
    });
});
