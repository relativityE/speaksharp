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

/**
 * Committed digests for the runtime binaries each family loads. The `onnxruntime-web` entries are the stable 1.30.0
 * build (PO 2026-09-28: Transformers.js 4.3.0 on stable ORT, never its declared 1.31 dev prerelease); they were
 * re-pinned from the installed package after its tarball integrity matched npm's published `dist.integrity`. The
 * 1.27.0 digests they replace are recorded in git history; rows measured on 1.27.0 remain historical, not re-labelled.
 */
export const RUNTIME_ASSET_PINS: Record<string, string> = {
    'node_modules/@xenova/transformers/dist/ort-wasm-simd-threaded.wasm':
        'ac23f2f3cbd519a65a0796f7c79eb34ead4c1f6f31eb06e14ed8a9579d697ef6',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs':
        '3d1c85995364bb643302fc6fd877a0c3ba5ae72401815e0f24828a53d9191e28',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm':
        '39f9f0894d478800487ed9f7dbe92618498db320cf55c8e3d89adff8dce658da',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs':
        '709853412fd1ffc34247af1e73569227b5b79629c5ca3f59cc39cf7e500e4947',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm':
        '3ad23231b5bd6d9dda55a7f84606315e0bf35b6750c28ee993c987c54cacab0f',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.mjs':
        '270e2c6da9f297239d301d329782b6446641cb1e16a77967690adcfca35f3268',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jspi.wasm':
        'a54c76f86b0f0d9572380cf1c6292a7b3903716ffcbcd6b0e5c7050bf430eb93',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs':
        'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b',
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm':
        '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
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
