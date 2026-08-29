/**
 * #1304 — the INFERENCE RUNTIME'S OWN BINARY is an asset too.
 *
 * The pin manifests cover model weights. They did not cover the WebAssembly build that executes them,
 * so `@xenova/transformers` reached for
 * `https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/ort-wasm-simd-threaded.wasm` at load
 * time and offline enforcement — correctly — refused it. Every v2 arm was rejected as `unpinned` and
 * emitted no WER.
 *
 * A model measured by an unverified runtime is not a pinned measurement. These digests bind the binary
 * that ran alongside the weights it ran on.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export interface RuntimeAsset {
    path: string;
    sha256: string;
    bytes: number;
}

/** Committed digests for the runtime binaries each family loads. */
export const RUNTIME_ASSET_PINS: Record<string, string> = {
    'node_modules/@xenova/transformers/dist/ort-wasm-simd-threaded.wasm':
        'ac23f2f3cbd519a65a0796f7c79eb34ead4c1f6f31eb06e14ed8a9579d697ef6',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs':
        '7236653b8565da4046e459cd0e274123419a1d9f1f8f18fd36c28058346ca655',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm':
        '7e83cd6cee77e478bc96a7e91b198144fb5e4126287daf1f9b54bb195ebcd55a',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs':
        '3ee381d20a80f51a788a1c4a5872f6f1d047538dd4342f4af00062de5f9ea4c6',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm':
        '78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.mjs':
        '47f5232865f07cc6a11e825cac8dfd9b75bdf5f4a0889bde077e753ae93d3913',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.wasm':
        '7c28cdb40958a998f5aa0981d5cb8e57ac1e7e9b4d2f18a7d74e00dd9629d7a3',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs':
        '0a1e718d99c41b22c21f2520ff4f9e883a6b5533856e398d21816ee8eb8185d3',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm':
        'd1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
};

export type RuntimeAssetFailure =
    | { ok: false; reason: 'runtime_asset_missing'; detail: string }
    | { ok: false; reason: 'runtime_asset_digest_mismatch'; detail: string }
    | { ok: false; reason: 'runtime_asset_unpinned'; detail: string };

/**
 * Verify a runtime binary against its committed digest.
 *
 * An UNPINNED path fails rather than passing silently — the whole defect was a runtime asset nobody
 * had listed, so "not in the table" must be a failure and not a skip.
 */
export function verifyRuntimeAsset(path: string): { ok: true; asset: RuntimeAsset } | RuntimeAssetFailure {
    const expected = RUNTIME_ASSET_PINS[path];
    if (expected === undefined) return { ok: false, reason: 'runtime_asset_unpinned', detail: path };
    if (!existsSync(path)) return { ok: false, reason: 'runtime_asset_missing', detail: path };
    const bytes = readFileSync(path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== expected) {
        return { ok: false, reason: 'runtime_asset_digest_mismatch', detail: `${sha256} != ${expected}` };
    }
    return { ok: true, asset: { path, sha256, bytes: bytes.length } };
}

/** The runtime binaries a given family loads in the browser. */
export function runtimeAssetsFor(runtime: 'v2' | 'v4' | 'moonshine' | 'moonshine-wasm'): string[] {
    // I FIRST BELIEVED v4 AND MOONSHINE BUNDLED THEIR RUNTIME and fetched no separate binary. The
    // clean-workspace check refuted that immediately: every `@huggingface/transformers` arm was refused
    // for three unpinned `cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-*` files. The same
    // defect as v2, in a second package — and the same reason it hid, since no arm had been run under
    // offline enforcement.
    //
    // `moonshine-wasm` genuinely ships its own `moonshine.wasm` inside the package we serve, so it
    // fetches nothing extra; that one is verified by observation, not by assumption.
    if (runtime === 'v2') return ['node_modules/@xenova/transformers/dist/ort-wasm-simd-threaded.wasm'];
    if (runtime === 'v4' || runtime === 'moonshine') {
        return Object.keys(RUNTIME_ASSET_PINS).filter((p) => p.includes('onnxruntime-web'));
    }
    return [];
}
