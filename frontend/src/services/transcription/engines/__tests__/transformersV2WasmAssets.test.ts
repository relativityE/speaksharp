import { describe, expect, it } from 'vitest';

import {
    TRANSFORMERS_V2_WASM_ASSET_URLS,
    TRANSFORMERS_V2_WASM_PATH_PREFIX,
} from '../transformersV2WasmAssets';

describe('Transformers.js v2 ORT asset contract', () => {
    it('exposes every ORT 1.14 binary under one stable filename prefix', () => {
        expect(TRANSFORMERS_V2_WASM_PATH_PREFIX).toMatch(/\/$/);
        expect(Object.keys(TRANSFORMERS_V2_WASM_ASSET_URLS)).toEqual([
            'ort-wasm.wasm',
            'ort-wasm-threaded.wasm',
            'ort-wasm-simd.wasm',
            'ort-wasm-simd-threaded.wasm',
        ]);

        for (const [filename, assetUrl] of Object.entries(TRANSFORMERS_V2_WASM_ASSET_URLS)) {
            expect(assetUrl).toBe(`${TRANSFORMERS_V2_WASM_PATH_PREFIX}${filename}`);
        }
    });
});
