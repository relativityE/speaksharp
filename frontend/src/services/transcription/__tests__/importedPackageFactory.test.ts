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

import { CANDIDATES, admitPackageDescriptors, candidateForRuntime, type Candidate } from '../candidateRegistry';
import * as modelPackage from '../modelPackage';
import { constructPrivateEngine } from '../engines/PrivateSTT';
import { TransformersJSEngine } from '../engines/TransformersJSEngine';
import { MoonshineStreamingEngine } from '../engines/MoonshineStreamingEngine';
import { moonshineAssetsFor } from '../moonshineAssetPins';
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

describe('independent review of 27607fb3: an inert package cannot take over the incumbent\'s identity', () => {
    it('a package reusing the incumbent\'s cache directory is refused, and the incumbent stays the only no-selection attribution', async () => {
        const base = CANDIDATES['v2:base.en'];
        const copy = JSON.stringify(await modelPackage.sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'factory:copy-of-incumbent',
            engine: base.engine, runtime: base.runtime, model: { ...base.model, device: 'wasm' }, execution: { ...base.execution },
            assets: { servedFrom: base.assets.servedFrom, files: base.assets.files!.map(f => ({ ...f, url: `${base.assets.servedFrom}/${f.path}` })) },
            license: 'MIT (fixture declaration; no new model copied)' }));
        const { imported, rejections } = admitPackageDescriptors({ './model-packages/copy.json': copy }, modelPackage);
        expect(rejections).toEqual([{ file: './model-packages/copy.json', code: 'PACKAGE_IDENTITY_COLLISION' }]);
        expect(imported).toEqual({});
        // Two packages may not share a cache directory either.
        const twins = admitPackageDescriptors({ './model-packages/a.json': await fourthDescriptor('factory:twin-a'),
            './model-packages/b.json': await fourthDescriptor('factory:twin-b') }, modelPackage);
        expect(Object.keys(twins.imported)).toEqual(['factory:twin-a']);
        expect(twins.rejections).toEqual([{ file: './model-packages/b.json', code: 'PACKAGE_IDENTITY_COLLISION' }]);
        expect(candidateForRuntime({ engineType: 'transformers-js', variant: null } as never)).toBe('v2:base.en');
    });
});

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

/** A Moonshine package (PO 11-01 drop-in): the built-in medium model's DATA as a package; only data, no new runtime or bytes. */
async function moonshineDescriptor(over: (p: Record<string, unknown>) => void = () => {}, id = 'factory:moonshine-medium') {
    const base = CANDIDATES['moonshine:streaming-medium'];
    const pkg: Record<string, unknown> = {
        schemaVersion: 1, kind: 'speaksharp-model-package', id, engine: base.engine, runtime: base.runtime, model: base.model,
        execution: structuredClone(base.execution),
        assets: { files: moonshineAssetsFor(base).map(a => ({ path: a.file, url: a.url, bytes: a.bytes, sha256: a.sha256 })) },
        license: 'MIT (moonshine-ai/moonshine; fixture declaration, no model copied)' };
    // Sealed valid first; a negative case then alters the sealed descriptor, which admission must refuse by its shape code.
    const sealed = JSON.parse(JSON.stringify(await modelPackage.sealModelPackage(pkg as never))) as Record<string, unknown>;
    over(sealed);
    return JSON.stringify(sealed);
}

describe('a Moonshine model is a drop-in package (PO 11-01: no hardcoded models)', () => {
    it('is admitted, built into the real Moonshine adapter, and loads exactly the built-in pinned bytes and runtime arch', async () => {
        const { imported, rejections } = admitPackageDescriptors({ './model-packages/moonshine.json': await moonshineDescriptor() }, modelPackage);
        expect(rejections).toEqual([]);
        const pkg = imported['factory:moonshine-medium'];
        expect(pkg).toMatchObject({ engine: 'moonshine-streaming', comparisonReady: false, activationReady: false });
        const base = CANDIDATES['moonshine:streaming-medium'];
        expect(moonshineAssetsFor(pkg)).toEqual(moonshineAssetsFor(base));
        expect(pkg.execution.decode).toEqual(base.execution.decode);
        const engine = await constructPrivateEngine('moonshine-streaming', pkg, {} as never);
        expect(engine).toBeInstanceOf(MoonshineStreamingEngine);
        // The engine resolves ITS candidate from the facade's resolved selection, not a built-in catalogue lookup.
        const source = (engine as unknown as { options: { candidateSource: (id: string) => unknown } }).options.candidateSource;
        expect(source(pkg.id)).toBe(pkg);
        expect(source('moonshine:streaming-medium')).toBeUndefined();
    });

    it.each([
        ['a runtime script or wasm in the package', (p: Record<string, unknown>) => {
            const a = p.assets as { files: Record<string, unknown>[] };
            a.files.push({ path: 'runtime.js', url: 'https://download.moonshine.ai/x/runtime.js', bytes: 1, sha256: 'a'.repeat(64) });
        }, 'UNSUPPORTED_PACKAGE_RUNTIME_BYTES'],
        ['a weight not fetched over https', (p: Record<string, unknown>) => {
            const a = p.assets as { files: Record<string, unknown>[] };
            a.files[0] = { ...a.files[0], url: '/models/moonshine/' + String(a.files[0].path) };
        }, 'UNSUPPORTED_MOONSHINE_ASSETS'],
        ['a weight URL carrying a query', (p: Record<string, unknown>) => {
            const a = p.assets as { files: Record<string, unknown>[] };
            a.files[0] = { ...a.files[0], url: String(a.files[0].url) + '?v=1' };
        }, 'PACKAGE_ASSET_LOCATION_INVALID'],
        ['a duplicated runtime filename at distinct urls', (p: Record<string, unknown>) => {
            const a = p.assets as { files: Record<string, unknown>[] };
            a.files.push({ ...a.files[0], path: 'dup/' + a.files[0].path, url: 'https://download.moonshine.ai/dup/' + a.files[0].path });
        }, 'UNSUPPORTED_MOONSHINE_ASSETS'],
        ['a runtime arch that is not an enum member name', (p: Record<string, unknown>) => {
            ((p.execution as { decode: Record<string, unknown> }).decode).runtimeArch = '4';
        }, 'UNSUPPORTED_MOONSHINE_PROFILE'],
        ['a different runtime version', (p: Record<string, unknown>) => { p.runtime = { package: '@moonshine-ai/moonshine-wasm', version: '0.1.6' }; },
            'UNSUPPORTED_PACKAGE_RUNTIME'],
    ])('admission refuses %s', async (_, over, code) => {
        const { imported, rejections } = admitPackageDescriptors({ './model-packages/bad.json': await moonshineDescriptor(over) }, modelPackage);
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
