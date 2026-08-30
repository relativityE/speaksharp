import { describe, expect, it } from 'vitest';
import { buildAssetInventory, reconcileAssets, type AssetRecord, type ObservedRequest } from '../assetInventory';

/**
 * #1304 — the asset gate must be REAL, not circular.
 *
 * `buildAssetInventory(allArmAssets, modelBytes)` reconciled a total against a number computed from the
 * SAME object. That is a tautology: it can never detect a file the arm requested but the harness never
 * recorded, which is the omission worth catching. Reconciliation now compares the declared inventory
 * against an independently observed request ledger written by a different code path.
 */
const declared = (over: Record<string, Partial<AssetRecord>> = {}): Record<string, AssetRecord> => ({
    'onnx/encoder_model.onnx': { sha256: 'a'.repeat(64), bytes: 100, source: 'network', pinned: true, ...over['onnx/encoder_model.onnx'] },
    'onnx/decoder_model_merged_q4.onnx': { sha256: 'b'.repeat(64), bytes: 200, source: 'network', pinned: true, ...over['onnx/decoder_model_merged_q4.onnx'] },
    'tokenizer.json': { sha256: 'c'.repeat(64), bytes: 10, source: 'network', pinned: true, ...over['tokenizer.json'] },
});
const observed = (over: Record<string, Partial<ObservedRequest>> = {}): Record<string, ObservedRequest> => ({
    'onnx/encoder_model.onnx': { bytes: 100, status: 200, count: 1, ...over['onnx/encoder_model.onnx'] },
    'onnx/decoder_model_merged_q4.onnx': { bytes: 200, status: 200, count: 1, ...over['onnx/decoder_model_merged_q4.onnx'] },
    'tokenizer.json': { bytes: 10, status: 200, count: 1, ...over['tokenizer.json'] },
});
const run = (d = declared(), o = observed(), requirePinned = true) =>
    reconcileAssets(buildAssetInventory(d, null), o, { requirePinned });

describe('reconciliation compares TWO channels', () => {
    it('POSITIVE CONTROL: matching declaration and observation reconciles', () => {
        const r = run();
        expect(r.ok).toBe(true);
        expect(r.declaredFiles).toBe(3);
        expect(r.observedFiles).toBe(3);
        expect(r.declaredBytes).toBe(310);
        expect(r.observedBytes).toBe(310);
    });

    it('REJECTS an EMPTY inventory — the case a self-reconciling total always passed', () => {
        const r = reconcileAssets(buildAssetInventory({}, null), {}, { requirePinned: true });
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('empty_inventory');
    });

    it('REJECTS a file the arm REQUESTED but never declared — the omission a tautology cannot see', () => {
        const r = run(declared(), { ...observed(), 'onnx/decoder_model_merged.onnx': { bytes: 900, status: 200, count: 1 } });
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('observed_not_declared');
    });

    it('REJECTS a declared network file that was never actually requested', () => {
        const o = observed();
        delete o['onnx/decoder_model_merged_q4.onnx'];
        const r = run(declared(), o);
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('declared_not_observed');
    });

    it('a CACHED file is not required to appear in the ledger — an offline run is not a failure', () => {
        const d = declared({ 'onnx/encoder_model.onnx': { source: 'cache' } });
        const o = observed(); delete o['onnx/encoder_model.onnx'];
        expect(run(d, o).ok).toBe(true);
    });

    it('REJECTS a byte mismatch between declaration and observation', () => {
        const r = run(declared(), observed({ 'onnx/encoder_model.onnx': { bytes: 999 } }));
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('byte_mismatch');
    });

    it('REJECTS a duplicated request — the same file fetched twice is unattributed traffic', () => {
        const r = run(declared(), observed({ 'tokenizer.json': { count: 2 } }));
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('duplicate_request');
    });

    it('REJECTS an UNPINNED network asset when pinning is required', () => {
        const r = run(declared({ 'tokenizer.json': { pinned: false } }));
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('unpinned_asset');
    });

    it.each([['encoder', 'onnx/encoder_model.onnx'], ['decoder', 'onnx/decoder_model_merged_q4.onnx'], ['tokenizer', 'tokenizer.json']])(
        'REJECTS an inventory missing the required %s role', (_role, key) => {
            const d = declared(); delete d[key];
            const o = observed(); delete o[key];
            const r = run(d, o);
            expect(r.ok).toBe(false);
            expect(r.failures.map((f) => f.kind)).toContain('missing_required_role');
        });

    it('REJECTS a reported total that does not equal the decomposed total', () => {
        const inv = buildAssetInventory(declared(), 999);   // declared bytes are 310
        const r = reconcileAssets(inv, observed(), { requirePinned: true });
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('reported_total_mismatch');
    });

    it('a non-2xx response is not evidence the file arrived', () => {
        const r = run(declared(), observed({ 'tokenizer.json': { status: 404 } }));
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('declared_not_observed');
    });
});
