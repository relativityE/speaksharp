/**
 * #1304 Task 3C — the candidate matrix is COMPLETE, and every exclusion is a documented rejection.
 *
 * A silently omitted candidate is indistinguishable from one nobody considered. These assert that the
 * corrected #1304 matrix is fully represented and that no entry can be dropped without the drop being
 * visible — including the ones this harness cannot run.
 */
import { describe, it, expect } from 'vitest';
import {
    ARM_MATRIX, ADMITTED_ARMS, PENDING_ARMS, REJECTED_ARMS, SELECTION_ARMS, DIAGNOSTIC_ARMS,
    DISTINCT_CANDIDATES, ALIASED_ARMS,
} from '../arms/registry';
import { certifyArm } from '../certify';
import type { DecodeArm, RouteHonorReport } from '../engineArm';
import { resolveWhisperRoute, candidateRouteHash } from '../candidateRoute';

/** Every cell the corrected specification requires, by id. Adding a cell here without adding the arm
 *  fails; removing an arm without removing the requirement fails. */
const REQUIRED_CELLS = [
    'v2:tiny.en',
    'v2:base.en',
    'v2:base.en:no-conditioning',
    'v2:small.en',
    'v4:base:q4-decoder:wasm',
    'v4:base:q4-decoder:webgpu',
    'v4:base:fp32-decoder:cpu',
    'v4:base:int8-decoder:cpu',
    'v4:base:q8-decoder:cpu',
    'v4:distil-small.en:q4-decoder:webgpu',
    'moonshine:tiny',
    'moonshine:base',
] as const;

describe('the matrix covers every required candidate', () => {
    it('contains every cell of the corrected #1304 specification', () => {
        const ids = new Set(ARM_MATRIX.map((a) => a.id));
        expect(REQUIRED_CELLS.filter((cell) => !ids.has(cell))).toEqual([]);
    });

    it('includes Moonshine Tiny AND Base — both were required, and one was lost to shorthand once', () => {
        expect(ARM_MATRIX.filter((a) => a.runtime === 'moonshine').map((a) => a.id).sort())
            .toEqual(['moonshine:base', 'moonshine:tiny']);
    });

    it('covers all four v4 base decoder precisions', () => {
        const dtypes = ARM_MATRIX
            .filter((a) => a.runtime === 'v4' && a.modelId.includes('whisper-base.en'))
            .map((a) => (typeof a.dtype === 'object' ? a.dtype.decoder_model_merged : a.dtype));
        expect(new Set(dtypes)).toEqual(new Set(['q4', 'fp32', 'int8', 'q8']));
    });

    it('ids are unique — a duplicate would overwrite a result silently', () => {
        expect(new Set(ARM_MATRIX.map((a) => a.id)).size).toBe(ARM_MATRIX.length);
    });

    it('is frozen, so the matrix cannot be narrowed at runtime', () => {
        expect(Object.isFrozen(ARM_MATRIX)).toBe(true);
    });
});

describe('selection arms and diagnostic cells are distinguishable', () => {
    it('exactly 12 selection arms — the corrected #1304 matrix', () => {
        expect(SELECTION_ARMS).toHaveLength(12);
        expect(SELECTION_ARMS.map((a) => a.id).sort()).toEqual([...REQUIRED_CELLS].sort());
    });

    it('the 13th cell is DIAGNOSTIC and cannot be selected', () => {
        // `v4:base:q4-decoder:cpu` runs on onnxruntime-node, which the product does not ship. It
        // answers "is the q4 figure a property of the model or of the browser runtime?" — a question
        // about the harness. Leaving it unlabelled would let a stand-in read as a candidate.
        expect(DIAGNOSTIC_ARMS.map((a) => a.id)).toEqual(['v4:base:q4-decoder:cpu']);
        expect(SELECTION_ARMS.map((a) => a.id)).not.toContain('v4:base:q4-decoder:cpu');
    });

    it('the two roles account for every cell', () => {
        expect(SELECTION_ARMS.length + DIAGNOSTIC_ARMS.length).toBe(ARM_MATRIX.length);
    });
});

describe('the no-conditioning arm is rejected for a RUNTIME reason, with evidence', () => {
    const arm = ARM_MATRIX.find((a) => a.id === 'v2:base.en:no-conditioning');

    it('is rejected as runtime_option_unsupported', () => {
        expect(arm?.admission.status).toBe('rejected');
        if (arm?.admission.status !== 'rejected') return;
        expect(arm.admission.reason).toBe('runtime_option_unsupported');
    });

    it('the evidence records BOTH proofs, and claims no effect rather than equivalence', () => {
        if (arm?.admission.status !== 'rejected') throw new Error('not rejected');
        // The option is absent from both bundles...
        expect(arm.admission.evidence).toMatch(/0 occurrences/);
        // ...and the two-window comparison produced identical output.
        expect(arm.admission.evidence).toMatch(/37\.87s|two-window/);
        // "no measured effect" is the claim; "equivalent" would assert the option works.
        expect(arm.admission.evidence).toMatch(/no measured effect/);
        expect(arm.admission.evidence).not.toMatch(/equivalent(?!, which)/);
    });
});

describe('nothing is omitted: every cell is admitted, pending, or rejected', () => {
    it('the three states account for the whole matrix', () => {
        expect(ADMITTED_ARMS.length + PENDING_ARMS.length + REJECTED_ARMS.length).toBe(ARM_MATRIX.length);
    });

    it.each(PENDING_ARMS.map((a) => [a.id, a] as const))(
        '%s says what THIS HARNESS cannot do, and what would resolve it',
        (_id, arm) => {
            if (arm.admission.status !== 'pending_harness') throw new Error('not pending');
            expect(arm.admission.evidence.length).toBeGreaterThan(80);
            expect(arm.admission.resolvedBy.length).toBeGreaterThan(20);
        },
    );

    it('the WASM and WebGPU cells are now RUN BY THE BROWSER LANE, not pending', () => {
        // They were `pending_harness` while only a Node lane existed — a fact about the tooling, never
        // a property of the candidate. The browser lane resolves them.
        const deviceCells = ARM_MATRIX.filter((a) => a.device === 'wasm' || a.device === 'webgpu');
        expect(deviceCells).toHaveLength(3);
        for (const cell of deviceCells) {
            expect(cell.admission.status).toBe('admitted');
            if (cell.admission.status !== 'admitted') continue;
            expect(cell.admission.lane).toBe('browser');
        }
        expect(PENDING_ARMS).toHaveLength(0);
    });

    it('Moonshine is ADMITTED on its own native route', () => {
        // It was previously rejected for not returning Whisper timestamp chunks — a requirement the
        // product does not have, since it consumes transcript text.
        const moonshine = ARM_MATRIX.filter((a) => a.runtime === 'moonshine');
        expect(moonshine).toHaveLength(2);
        for (const arm of moonshine) {
            expect(arm.admission.status).toBe('admitted');
            expect(arm.family).toBe('moonshine');
            // Pinned revisions, so a result is about a specific artifact.
            expect(arm.revision).toMatch(/^[0-9a-f]{40}$/);
        }
    });

    it('the WebGPU pending state rests on a fact this process can check', () => {
        expect((globalThis as { navigator?: { gpu?: unknown } }).navigator?.gpu).toBeUndefined();
    });
});

/**
 * The MECHANISM behind the Moonshine rejection, proven without a network fetch.
 *
 * The real finding — that `return_timestamps: true` is accepted and silently dropped — comes from
 * running the model. What is asserted here is that the harness ACTS on such a report: an arm whose
 * probe says the option was not honoured must fail certification rather than proceed.
 */
describe('an unhonoured route fails certification', () => {
    const armWith = (honor: Partial<RouteHonorReport>): DecodeArm => ({
        id: 'probe-arm',
        declareRoute: (seconds) => resolveWhisperRoute('v2', 'whisper-base.en', seconds),
        decode: async () => 'anything',
        probeRouteHonored: async () => ({
            timestampsRequested: true, timestampsReturned: true, deviceRequested: 'cpu',
            deviceClaim: 'none' as const, deviceResolved: 'test', deviceVerifiable: true, detail: '', ...honor,
        }),
        provenance: () => ({
            model: { id: 'm', revision: 'r', filesSha256: { f: 'a'.repeat(64) } },
            runtime: { library: 'l', version: 'v', backend: 'b' },
            assets: { source: 's', verdict: 'unverifiable' },
            device: { platform: 'p', arch: 'a', cpuModel: 'c', cores: 1 },
            route: {
                hash: candidateRouteHash(resolveWhisperRoute('v2', 'whisper-base.en', 4.2)),
                route: resolveWhisperRoute('v2', 'whisper-base.en', 4.2),
            },
            corpus: { version: 'v', archives: { a: 'b' } },
            resources: { wallClockMs: 1, peakRssBytes: 1 },
        }),
    });

    const certify = (arm: DecodeArm, honor: RouteHonorReport) =>
        certifyArm(arm, { family: 'whisper', engine: 'v2', modelId: 'whisper-base.en' }, [], honor);
    const honorOf = async (arm: DecodeArm) => arm.probeRouteHonored('injected://probe', 1);

    it('timestamps requested but not returned fails on route_not_honored', async () => {
        const arm = armWith({ timestampsReturned: false });
        const result = certify(arm, await honorOf(arm));
        expect(result.failedGates).toContain('route_not_honored');
        expect(result.certified).toBe(false);
    });

    it('an unverifiable DEVICE CLAIM fails on device_unverifiable', async () => {
        const arm = armWith({ deviceClaim: 'webgpu', deviceVerifiable: false, deviceRequested: 'webgpu' });
        const result = certify(arm, await honorOf(arm));
        expect(result.failedGates).toContain('device_unverifiable');
    });

    it('a device claim with NO resolved backend fails — echoing the request is not evidence', async () => {
        const arm = armWith({ deviceClaim: 'webgpu', deviceVerifiable: true, deviceResolved: null });
        expect(certify(arm, await honorOf(arm)).failedGates).toContain('backend_unresolved');
    });

    it('an ACCURACY arm claims no device and is not asked to prove one', async () => {
        // Separating the claims is what stops a Node accuracy run from reading as a browser result —
        // and what makes "Node cannot run WASM" a pending harness rather than a rejected candidate.
        const arm = armWith({ deviceClaim: 'none', deviceResolved: null, deviceVerifiable: false });
        const failed = certify(arm, await honorOf(arm)).failedGates;
        expect(failed).not.toContain('device_unverifiable');
        expect(failed).not.toContain('backend_unresolved');
    });

    it('an honoured route contributes no failure of its own', async () => {
        // Positive control: the oracle gate still fails here because no vectors were supplied, which
        // is what proves these two gates are being evaluated independently rather than as one flag.
        const arm = armWith({});
        const result = certify(arm, await honorOf(arm));
        expect(result.failedGates).not.toContain('route_not_honored');
        expect(result.failedGates).not.toContain('device_unverifiable');
        expect(result.failedGates).toContain('oracle_vectors');
    });
});

/**
 * #1304 — a dtype ALIAS is one candidate under two names.
 *
 * `v4:base:int8` and `v4:base:q8` both scored 0.0479 on the 459-word set. A matching WER proves
 * nothing on its own — two models can make 22 errors in different places — so the decoder graphs were
 * hashed:
 *
 *   dd4761a3f7add26a…  decoder_model_merged_int8.onnx
 *   dd4761a3f7add26a…  decoder_model_merged_quantized.onnx      cmp: byte-identical
 *
 * transformers.js maps `int8` → `_int8.onnx` and `q8` → `_quantized.onnx`, and upstream published the
 * SAME BYTES under both names. Ranking both would list one model twice and read as two independent
 * results agreeing with each other.
 */
describe('a dtype alias never counts twice', () => {
    it('q8 is recorded as an alias of int8', () => {
        const q8 = ARM_MATRIX.find((a) => a.id === 'v4:base:q8-decoder:cpu');
        expect(q8?.dtypeAliasOf).toBe('v4:base:int8-decoder:cpu');
    });

    it('the alias target exists and is NOT itself an alias', () => {
        // Otherwise a chain of aliases could collapse to nothing.
        const q8 = ARM_MATRIX.find((a) => a.id === 'v4:base:q8-decoder:cpu');
        const target = ARM_MATRIX.find((a) => a.id === q8?.dtypeAliasOf);
        expect(target).toBeTruthy();
        expect(target?.dtypeAliasOf).toBeUndefined();
    });

    it('the alias is EXCLUDED from distinct candidates but RETAINED in the matrix', () => {
        // Retained, because the matrix must still show that both dtypes were requested and where they
        // landed. Deleting the row would hide a real question someone will ask again.
        expect(DISTINCT_CANDIDATES.map((a) => a.id)).not.toContain('v4:base:q8-decoder:cpu');
        expect(ARM_MATRIX.map((a) => a.id)).toContain('v4:base:q8-decoder:cpu');
        expect(ALIASED_ARMS.map((a) => a.id)).toEqual(['v4:base:q8-decoder:cpu']);
    });

    it('distinct candidates are exactly the selection arms minus the aliases', () => {
        expect(DISTINCT_CANDIDATES.length).toBe(SELECTION_ARMS.length - ALIASED_ARMS.length);
    });

    it('every alias names a DIFFERENT arm — an arm cannot alias itself', () => {
        for (const arm of ALIASED_ARMS) expect(arm.dtypeAliasOf).not.toBe(arm.id);
    });
});
