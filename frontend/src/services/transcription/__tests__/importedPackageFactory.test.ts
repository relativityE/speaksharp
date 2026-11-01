/**
 * #1760 finding 4: an imported package reaches the REAL product adapter.
 *
 * The descriptor goes through the same admission function the bundle uses for `model-packages/*.json`,
 * then through the facade's own engine factory. Nothing is loaded: no model, worker or network. The
 * armed refusal uses a mocked arm (the authorization module reports armed), not a signed CDP arm.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

const arm = vi.hoisted(() => ({ armed: false }));
vi.mock('../modelComparisonAuthorization', async (original) => {
    const actual = await original<typeof import('../modelComparisonAuthorization')>();
    return {
        ...actual,
        hasModelComparisonAuthorization: () => arm.armed,
        consumeModelComparisonTakeAuthorization: () => arm.armed,
    };
});

import { CANDIDATES, admitPackageDescriptors, type Candidate } from '../candidateRegistry';
import * as modelPackage from '../modelPackage';
import { constructPrivateEngine } from '../engines/PrivateSTT';
import { TransformersJSEngine } from '../engines/TransformersJSEngine';
import { sttRegistry } from '../STTRegistry';
import {
    clearRuntimeCandidateOverride, registerSwitchExecutor, runtimeCandidateOverride, switchCandidate,
} from '../runtimeCandidateSwitch';

beforeAll(() => { vi.stubGlobal('crypto', webcrypto); });
beforeEach(() => { sttRegistry.clear(); arm.armed = false; });
afterEach(() => {
    registerSwitchExecutor(null);
    clearRuntimeCandidateOverride();
    vi.unstubAllEnvs();
});

/** A fourth package reusing the installed v2 Whisper adapter; only its data is new. */
async function fourthDescriptor(id = 'factory:fourth-whisper') {
    const base = CANDIDATES['v2:base.en'];
    const localModelId = 'factory-fourth-whisper';
    return JSON.stringify(await modelPackage.sealModelPackage({
        schemaVersion: 1, kind: 'speaksharp-model-package', id, engine: base.engine, runtime: base.runtime,
        model: { ...base.model, device: 'wasm' }, execution: { ...base.execution, localModelId },
        assets: { servedFrom: `/models/${localModelId}`,
            files: base.assets.files!.map(f => ({ ...f, url: `/models/${localModelId}/${f.path}` })) },
        license: 'MIT (fixture declaration; no new model copied)' }));
}

describe('an imported package reaches the real product adapter', () => {
    it('is admitted by the bundle path and built by the facade factory into the installed Whisper adapter', async () => {
        const { imported, rejections } = admitPackageDescriptors({ './model-packages/fourth.json': await fourthDescriptor() }, modelPackage);
        expect(rejections).toEqual([]);
        const fourth = imported['factory:fourth-whisper'];
        expect(fourth).toMatchObject({ engine: 'transformers-js', comparisonReady: false, activationReady: false });
        expect(fourth.modelPackage?.sourcePath).toBe('frontend/src/services/transcription/model-packages/fourth.json');
        expect(CANDIDATES[fourth.id]).toBeUndefined();

        const engine = await constructPrivateEngine('transformers-js', fourth, { resolvedCandidate: fourth } as never);
        expect(engine).toBeInstanceOf(TransformersJSEngine);
        // What the adapter will load is the package's own self-hosted directory, not the incumbent's.
        const resolved = (engine as unknown as { resolvedModel(): { localId: string; remoteId: string } }).resolvedModel();
        expect(resolved).toEqual(expect.objectContaining({ localId: 'factory-fourth-whisper', remoteId: fourth.model.id }));
        expect(resolved.localId).not.toBe(CANDIDATES['v2:base.en'].execution.localModelId);
    });

    it('refuses an engine kind the descriptor does not declare', async () => {
        const { imported } = admitPackageDescriptors({ './model-packages/fourth.json': await fourthDescriptor() }, modelPackage);
        await expect(constructPrivateEngine('parakeet-tdt', imported['factory:fourth-whisper'], {} as never))
            .rejects.toThrow(/cannot initialize parakeet-tdt/);
    });

    it.each([
        ['an oversized descriptor', () => ' '.repeat(1_048_577), 'PACKAGE_DESCRIPTOR_TOO_LARGE'],
        ['a package shadowing a built-in id', () => fourthDescriptor('v2:base.en'), 'PACKAGE_DUPLICATE_ID'],
        ['malformed JSON', () => '{not json', 'PACKAGE_INVALID'],
    ])('admission refuses %s with its code and admits nothing', async (_, make, code) => {
        const { imported, rejections } = admitPackageDescriptors({ './model-packages/bad.json': await make() }, modelPackage);
        expect(imported).toEqual({});
        expect(rejections).toEqual([{ file: './model-packages/bad.json', code }]);
    });
});

describe('an unqualified imported package is refused by an ARMED production build', () => {
    it('refuses the switch before any engine work, even with the comparison authorization armed', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', '');
        arm.armed = true;
        const { imported } = admitPackageDescriptors({ './model-packages/fourth.json': await fourthDescriptor() }, modelPackage);
        const fourth: Candidate = imported['factory:fourth-whisper'];
        const calls: string[] = [];
        registerSwitchExecutor({
            currentState: () => 'READY',
            teardown: async () => { calls.push('teardown'); },
            initialize: async () => { calls.push('initialize'); },
            observedCandidate: () => runtimeCandidateOverride(),
        });
        const outcome = await switchCandidate(fourth.id, { ...CANDIDATES, [fourth.id]: fourth });
        expect(outcome).toMatchObject({ ok: false, code: 'not_comparison_candidate' });
        expect(calls).toEqual([]);
        expect(runtimeCandidateOverride()).toBeNull();
    });
});
