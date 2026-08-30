import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARM_MATRIX, NOT_EXECUTED_REASONS } from '../arms/registry';

/**
 * #1304 — the int8 candidate's identity must match what it measurably does.
 *
 * The registry said Node-only and "ORT Web refuses to create a session … unusable in the browser". The
 * retained r6 preflight records the same arm with requestedDevice wasm, resolvedBackend wasm,
 * backendProven true, runtime ort-web-1.27.0, loading decoder_model_merged_int8.onnx and decoding 23/23.
 * The browser runner meanwhile admitted the arm anyway — the registry and the runner disagreed in place.
 */
const int8 = ARM_MATRIX.find((a) => a.id === 'v4:base:int8-decoder:cpu')!;
const q8 = ARM_MATRIX.find((a) => a.id === 'v4:base:q8-decoder:cpu')!;
const REG = readFileSync(resolve(__dirname, '../arms/registry.ts'), 'utf8');

describe('int8 identity reflects measurement, not a stale claim', () => {
    it('POSITIVE CONTROL: the historical ID maps to exactly ONE browser-WASM int8 candidate', () => {
        expect(int8.historicalArmId).toBe('v4:base:int8-decoder:cpu');
        expect(int8.candidate).toBe('base_int8');
        expect(int8.executionBackend).toBe('browser_wasm');
        expect(int8.admission.status).toBe('admitted');
        expect((int8.admission as { lane?: string }).lane).toBe('browser');
        // Exactly one arm is the MEASURED base_int8 candidate; the alias does not create a second.
        const measuredInt8 = ARM_MATRIX.filter(
            (a) => a.candidate === 'base_int8' && NOT_EXECUTED_REASONS[a.id] === undefined,
        );
        expect(measuredInt8.map((a) => a.id)).toEqual(['v4:base:int8-decoder:cpu']);
    });

    it('the stale "ORT Web refuses" claim no longer stands as current fact on the int8 arm', () => {
        const entry = REG.slice(REG.indexOf("id: 'v4:base:int8-decoder:cpu'"), REG.indexOf("id: 'v4:base:q8-decoder:cpu'"));
        expect(entry).toContain('CORRECTED FROM MEASUREMENT');
        expect(entry).toContain('ort-web-1.27.0');
        // The old wording is RETAINED, but only inside the quoted "this is what it used to say" block —
        // deleting it would hide what was corrected. What matters is that it no longer stands on its own
        // as a current claim, so assert POSITION rather than absence.
        const correction = entry.indexOf('CORRECTED FROM MEASUREMENT');
        const staleClaim = entry.indexOf('this precision is unusable there');
        expect(staleClaim).toBeGreaterThan(correction);
        expect(entry).not.toMatch(/admission: \{ status: 'admitted', lane: 'node' \}/);
    });

    it('q8 stays a byte-identical ALIAS and can never rank separately', () => {
        expect(q8.dtypeAliasOf).toBe('v4:base:int8-decoder:cpu');
        expect(NOT_EXECUTED_REASONS['v4:base:q8-decoder:cpu']).toBe('alias_of_int8');
        expect(q8.candidate).toBe('base_int8');
    });

    it('CASUALTY: int8 and q4 cannot share a route/config fingerprint', () => {
        // If the fingerprint came from the human-readable ID or the model alone, the two decoders would
        // collide and one row could be read as the other. The dtype is what distinguishes them.
        const q4 = ARM_MATRIX.find((a) => a.id === 'v4:base:q4-decoder:wasm')!;
        expect(int8.modelId).toBe(q4.modelId);                       // same model...
        expect(int8.dtype).not.toEqual(q4.dtype);                    // ...different decoder precision
        const fp = (a: typeof int8) => JSON.stringify({ model: a.modelId, dtype: a.dtype });
        expect(fp(int8)).not.toBe(fp(q4));
    });

    it('the retained preflight is what establishes the browser-WASM claim', () => {
        const art = JSON.parse(readFileSync(
            resolve(__dirname, '../../../../evidence-runs/1304-preflight-r6/decode-4cell.json'), 'utf8',
        )) as { results: Array<Record<string, unknown>> };
        const row = art.results.find((r) => r.id === 'v4:base:int8-decoder:cpu')!;
        expect(row.requestedDevice).toBe('wasm');
        expect(String(row.resolvedBackend)).toMatch(/^wasm/);
        expect(row.backendProven).toBe(true);
        expect(row.decodedClips).toBe(row.expectedClips);
    });
});

describe('the ARTIFACT — not the registry — carries the tested identity', () => {
    // The registry was corrected while the artifact serialized candidate, executionBackend and
    // historicalArmId as null, so a reader of the EVIDENCE still had to infer the candidate and backend
    // from the historical arm ID — the exact inference the correction exists to stop.
    const RUNNER = readFileSync(resolve(__dirname, '../../../../scripts/run-browser-matrix.mts'), 'utf8');

    it('the measured row serializes candidate, backend, historical id, dtype and alias', () => {
        const row = RUNNER.slice(RUNNER.indexOf('candidate: spec.candidate'), RUNNER.indexOf('verdict,'));
        for (const field of [
            'candidate: spec.candidate', 'executionBackend: spec.executionBackend',
            'historicalArmId: spec.historicalArmId', 'dtype: spec.dtype', 'dtypeAliasOf: spec.dtypeAliasOf',
        ]) expect(row, `${field} is not serialized onto the evidence row`).toContain(field);
    });

    it('the historical id falls back to the arm id rather than serializing null', () => {
        expect(RUNNER).toContain('historicalArmId: spec.historicalArmId ?? spec.id');
    });

    it('q8 remains explicitly non-ranking as the int8 alias', () => {
        expect(q8.dtypeAliasOf).toBe('v4:base:int8-decoder:cpu');
        expect(NOT_EXECUTED_REASONS['v4:base:q8-decoder:cpu']).toBe('alias_of_int8');
    });
});
