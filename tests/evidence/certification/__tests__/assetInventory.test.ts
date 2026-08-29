import { describe, it, expect } from 'vitest';
import { buildAssetInventory, roleOf, type AssetRecord } from '../assetInventory';

const rec = (bytes: number): AssetRecord => ({ sha256: 'a'.repeat(64), bytes, source: 'cache', pinned: true });

describe('#1304 per-arm asset inventory decomposes the aggregate', () => {
    const assets: Record<string, AssetRecord> = {
        'ort-wasm-simd-threaded.jsep.wasm': rec(20_000_000),
        'onnx-community/x/onnx/encoder_model.onnx': rec(80_000_000),
        'onnx-community/x/onnx/decoder_model_merged.onnx': rec(40_000_000),
        'onnx-community/x/tokenizer.json': rec(2_000_000),
        'onnx-community/x/config.json': rec(1_000),
    };

    it('classifies each file by role from its path', () => {
        expect(roleOf('ort-wasm-simd-threaded.jsep.wasm')).toBe('runtime');
        expect(roleOf('a/onnx/encoder_model.onnx')).toBe('encoder');
        expect(roleOf('a/onnx/decoder_model_merged.onnx')).toBe('decoder');
        expect(roleOf('a/tokenizer.json')).toBe('tokenizer');
        expect(roleOf('a/preprocessor_config.json')).toBe('config');
    });

    it('subtotals by role and sums to the file total', () => {
        const inv = buildAssetInventory(assets, 142_001_000);
        expect(inv.fileCount).toBe(5);
        expect(inv.byRole.runtime.bytes).toBe(20_000_000);
        expect(inv.byRole.encoder.bytes).toBe(80_000_000);
        expect(inv.byRole.decoder.bytes).toBe(40_000_000);
        expect(inv.totalBytes).toBe(142_001_000);
        expect(Object.values(inv.byRole).reduce((a, r) => a + r.bytes, 0)).toBe(inv.totalBytes);
    });

    it('RECONCILES against the reported aggregate — the check that was impossible before', () => {
        expect(buildAssetInventory(assets, 142_001_000).reconcilesToModelBytes).toBe(true);
        const mismatch = buildAssetInventory(assets, 233_100_000);
        expect(mismatch.reconcilesToModelBytes).toBe(false);
        // The DELTA is what makes a discrepancy actionable rather than merely visible.
        expect(mismatch.reconciliationDeltaBytes).toBe(142_001_000 - 233_100_000);
    });

    it('is not silently empty — an empty map is reported as zero, not omitted', () => {
        const inv = buildAssetInventory({}, 54_458_545);
        expect(inv.fileCount).toBe(0);
        expect(inv.totalBytes).toBe(0);
        expect(inv.reconcilesToModelBytes).toBe(false);
        expect(inv.reconciliationDeltaBytes).toBe(-54_458_545);
    });

    it('orders files largest-first so the dominant cost reads immediately', () => {
        const inv = buildAssetInventory(assets, null);
        expect(inv.files[0].name).toContain('encoder_model');
        expect(inv.reconcilesToModelBytes).toBeNull();
    });
});
