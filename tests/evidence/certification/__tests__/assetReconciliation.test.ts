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

    it('RECORDS a repeated request without failing the arm', () => {
        // CORRECTED after the first preflight: onnxruntime fetched the same `.mjs` four times, once per
        // worker. That is ordinary browser behaviour, and failing on it would disqualify a correct arm.
        // It stays visible as an observation rather than being silently dropped.
        const r = run(declared(), observed({ 'tokenizer.json': { count: 2 } }));
        expect(r.ok).toBe(true);
        expect(r.repeatedRequests).toContain('tokenizer.json ×2');
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

describe('the matcher pairs the same file across differently-named channels', () => {
    // Found by the FIRST preflight run, not by review: the declared inventory names a runtime binary by
    // its filesystem source while the ledger names it by the URL it was served from.
    const runtimeDeclared = {
        'node_modules/@xenova/transformers/dist/ort-wasm-simd-threaded.wasm':
            { sha256: 'd'.repeat(64), bytes: 9960821, source: 'network' as const, pinned: true },
        'whisper-base.en/onnx/encoder_model_quantized.onnx': { sha256: 'e'.repeat(64), bytes: 10, source: 'network' as const, pinned: true },
        'whisper-base.en/onnx/decoder_model_merged_quantized.onnx': { sha256: 'f'.repeat(64), bytes: 10, source: 'network' as const, pinned: true },
        'whisper-base.en/tokenizer.json': { sha256: '0'.repeat(64), bytes: 10, source: 'network' as const, pinned: true },
    };
    const runtimeObserved = {
        'runtime/xenova/ort-wasm-simd-threaded.wasm': { bytes: 9960821, status: 200, count: 1 },
        'whisper-base.en/onnx/encoder_model_quantized.onnx': { bytes: 10, status: 200, count: 1 },
        'whisper-base.en/onnx/decoder_model_merged_quantized.onnx': { bytes: 10, status: 200, count: 1 },
        'whisper-base.en/tokenizer.json': { bytes: 10, status: 200, count: 1 },
    };

    it('a unique basename served from a different path is the SAME file, not a missing one', () => {
        const r = reconcileAssets(buildAssetInventory(runtimeDeclared, null), runtimeObserved, { requirePinned: true });
        expect(r.failures.map((f) => f.kind)).not.toContain('observed_not_declared');
        expect(r.failures.map((f) => f.kind)).not.toContain('declared_not_observed');
        expect(r.ok).toBe(true);
    });

    it('but an AMBIGUOUS basename is never collapsed — that would hide a real omission', () => {
        // Two different config.json files. Pairing them by basename would turn a genuine mismatch into a
        // false match, which is the worse of the two errors.
        const d = {
            'repo-a/config.json': { sha256: 'a'.repeat(64), bytes: 10, source: 'network' as const, pinned: true },
            'repo-b/config.json': { sha256: 'b'.repeat(64), bytes: 20, source: 'network' as const, pinned: true },
            'x/onnx/encoder_model.onnx': { sha256: 'c'.repeat(64), bytes: 10, source: 'network' as const, pinned: true },
            'x/onnx/decoder_model.onnx': { sha256: 'd'.repeat(64), bytes: 10, source: 'network' as const, pinned: true },
            'x/tokenizer.json': { sha256: 'e'.repeat(64), bytes: 10, source: 'network' as const, pinned: true },
        };
        const o = {
            'served/config.json': { bytes: 10, status: 200, count: 1 },
            'other/config.json': { bytes: 20, status: 200, count: 1 },
            'x/onnx/encoder_model.onnx': { bytes: 10, status: 200, count: 1 },
            'x/onnx/decoder_model.onnx': { bytes: 10, status: 200, count: 1 },
            'x/tokenizer.json': { bytes: 10, status: 200, count: 1 },
        };
        const r = reconcileAssets(buildAssetInventory(d, null), o, { requirePinned: true });
        expect(r.ok).toBe(false);
        expect(r.failures.map((f) => f.kind)).toContain('observed_not_declared');
    });
});
