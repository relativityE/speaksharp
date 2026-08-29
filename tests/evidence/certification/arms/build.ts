/**
 * #1304 Task 3C — turn a matrix entry into a runnable arm.
 *
 * One place where a spec becomes an adapter, so the report and the execution cannot disagree about
 * what an arm is. A rejected entry is NOT constructible: attempting it throws with the recorded
 * reason, which makes "we skipped it because it was rejected" impossible to confuse with "we ran it".
 */
import { resolve } from 'node:path';
import { createTransformersV2Arm } from './transformersV2Arm';
import { createTransformersV4Arm, type V4Device } from './transformersV4Arm';
import { createMoonshineArm } from './moonshineArm';
import type { ArmSpec } from './registry';
import type { ArmProvenance, DecodeArm } from '../engineArm';

export function buildArm(spec: ArmSpec, corpus: ArmProvenance['corpus']): DecodeArm {
    if (spec.admission.status === 'rejected') {
        throw new Error(`arm ${spec.id} is REJECTED (${spec.admission.reason}): ${spec.admission.evidence}`);
    }
    if (spec.admission.status === 'pending_harness') {
        // Not constructible HERE — but not rejected either. The cell stays open until the lane that
        // can run it exists, and confusing the two is how a capable candidate silently disappears.
        throw new Error(
            `arm ${spec.id} is PENDING a harness (${spec.admission.reason}): ${spec.admission.resolvedBy}`,
        );
    }

    switch (spec.runtime) {
        case 'v2':
            return createTransformersV2Arm({
                id: spec.id,
                // A remote candidate has no self-hosted directory; the model id doubles as the HF id.
                localModelId: spec.localModelId ?? spec.modelId,
                modelsRoot: resolve('frontend/public/models'),
                allowRemote: spec.localModelId === undefined,
                decodeOverrides: spec.decodeOverrides,
                corpus,
            });
        case 'v4':
            return createTransformersV4Arm({
                id: spec.id,
                modelId: spec.modelId,
                dtype: typeof spec.dtype === 'object' ? spec.dtype : {},
                device: spec.device as V4Device,
                variantId: spec.variantId,
                corpus,
            });
        case 'moonshine-wasm':
            // Browser-lane only: its runtime IS a browser runtime. `run-browser-matrix` constructs it
            // directly against the page, so there is no Node arm to build.
            throw new Error(
                `arm ${spec.id} runs on @moonshine-ai/moonshine-wasm, which exists only in the browser `
                + 'lane — build it there, not through the Node factory.',
            );
        case 'moonshine':
            return createMoonshineArm({
                id: spec.id,
                modelId: spec.modelId,
                revision: spec.revision ?? 'main',
                dtype: typeof spec.dtype === 'string' ? spec.dtype : 'q8',
                corpus,
            });
    }
}

/** What the parity gate must compare this arm against: family, engine, model and variant together. */
export function expectationFor(spec: ArmSpec) {
    return {
        family: spec.family,
        engine: (spec.runtime === 'v4' ? 'v4' : 'v2') as 'v2' | 'v4',
        // The arms load by their own id: a self-hosted directory name, or the HF repository id.
        modelId: spec.runtime === 'v2' ? (spec.localModelId ?? spec.modelId) : spec.modelId,
        ...(spec.variantId ? { variantId: spec.variantId } : {}),
    };
}
