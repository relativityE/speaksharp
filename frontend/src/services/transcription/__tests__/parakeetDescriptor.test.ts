import { createHash, webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CANDIDATES, identityOf, assetsVerified, isQualificationGrade } from '../candidateRegistry';
import { resolveCandidate } from '../candidateSelection';
import { assetRequestsFor, resolveCandidateAssetUrl } from '../candidateAssetRequests';
import { COMPARISON_CANDIDATE_IDS } from '../runtimeCandidateSwitch';
import { getDefaultProviderForMode, getProviderEntry } from '../providers/sttProviderConfig';
import { resolvePrivateAssignment, buildEngineVersion } from '../privateTelemetry';
import { assertParakeetProfile, requiredParakeetFiles } from '../engines/parakeet/contracts';
import pins from '../engines/parakeet/assetPins.json';
import { PARAKEET_EXECUTABLE_ROLES, candidateFromPackage, sealModelPackage } from '../modelPackage';

const candidate = CANDIDATES['parakeet:tdt-v3:int8'];
afterEach(() => { vi.unstubAllEnvs(); });

describe('non-default Parakeet TDT descriptor', () => {
    it('carries explicit export/precision/runtime identity without claiming the unpublished development version', () => {
        expect(candidate.engine).toBe('parakeet-tdt');
        expect(candidate.model.dtype).toEqual({ encoder_model: 'int8', decoder_joint_model: 'int8' });
        expect(candidate.model.device).toBe('wasm');
        expect(candidate.model.revision).toBeNull();
        expect(candidate.model.export).toMatchObject({ repository: pins.repository, revision: pins.revision });
        expect(candidate.runtime).toMatchObject({ package: 'parakeet.js', version: '1.4.4',
            integrity: pins.runtime.integrity, dependencies: { 'onnxruntime-web': '1.24.1' } });
        expect(candidate.execution.decode).toMatchObject({ kind: 'parakeet-tdt', backend: 'wasm',
            encoderPrecision: 'int8', decoderPrecision: 'int8', vocabularySize: 8193, blankId: 8192 });
    });

    it('permits explicit internal selection while retaining production qualification gates and default', () => {
        expect(candidate.activationReady).toBe(false);
        expect(candidate.comparisonReady).toBe(false);
        expect(candidate.browser.ok).toBe(true);
        expect(resolveCandidate(candidate.id)).toBe(candidate);
        expect(COMPARISON_CANDIDATE_IDS).not.toContain(candidate.id);
        expect(getDefaultProviderForMode('private')).toBe('transformers-js');
        expect(getProviderEntry('private', 'parakeet-tdt')?.status).toBe('available');
        expect(pins.runtimeInventoryComplete).toBe(true);
        expect(assetsVerified(identityOf(candidate))).toBe(true);
        // This helper checks attributable configured identity/pins, not completed model qualification.
        expect(isQualificationGrade(identityOf(candidate))).toBe(true);
    });

    it('requires all seven model and verified runtime artifacts with no extra inventory', () => {
        const profile = candidate.execution.decode;
        if (profile.kind !== 'parakeet-tdt') throw new Error('Wrong descriptor family');
        const required = requiredParakeetFiles(profile);
        const modelFiles = pins.files.map(file => file.path);
        expect(required.filter(file => !modelFiles.includes(file))).toEqual(pins.missingRuntimeFiles);
        expect(pins.files).toHaveLength(7);
        expect(pins.runtime.onnxruntime.binaryBytesVerified).toBe(true);
        expect(pins.missingRuntimeFiles).toEqual([]);
    });

    it('recomputes the entire pinned inventory digest and exact acquisition URLs', () => {
        const hash = createHash('sha256');
        for (const file of [...pins.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
            const pattern = file.url.startsWith('https://') ? new RegExp(`/resolve/${pins.revision}/`)
                : /^\/models\/parakeet-runtime\/1\.4\.4-ort1\.24\.1\//;
            expect(file.url).toMatch(pattern);
            hash.update(`${file.path}:${file.sha256}\n`);
        }
        expect(hash.digest('hex')).toBe(candidate.assets.pinDigest);
        expect(pins.files.reduce((total, file) => total + file.bytes, 0)).toBe(candidate.assets.totalBytes);
        expect(assetRequestsFor(candidate).assets).toEqual(pins.files.map(file => ({
            file: file.path, bytes: file.bytes, url: resolveCandidateAssetUrl(file.url),
        })));
    });

    it('keeps configured provenance and legacy engine labels distinct from observed weights', () => {
        expect(identityOf(candidate).configuredModel.id).toBe('nvidia/parakeet-tdt-0.6b-v3');
        const assignment = resolvePrivateAssignment({ resolvedEngineType: 'parakeet-tdt',
            overrideActive: false, allowlisted: false, rolloutEnabled: false });
        expect(assignment.engine_variant).toBe('private_parakeet');
        expect(buildEngineVersion(assignment.engine_variant, candidate.model.id)).toContain('private_parakeet');
    });

    it.each(['//foreign.invalid/model', '/models/../secret', 'http://foreign.invalid/model', 'file:///model'])(
        'refuses untrusted explicit asset URL %s', url => {
            expect(() => resolveCandidateAssetUrl(url)).toThrow('Pinned asset URL');
        });

    it('shared facade readiness identifies the selected adapter instead of probing the Whisper default', async () => {
        vi.stubEnv('VITE_INTERNAL_BUILD', 'true');
        const { PrivateSTT } = await import('../engines/PrivateSTT');
        const facade = new PrivateSTT({ evaluatorCandidateId: candidate.id, evaluatorBackend: 'wasm',
            onReady: vi.fn(), onTranscriptUpdate: vi.fn() });
        vi.stubGlobal('Worker', class {});
        expect(await facade.checkAvailability()).toMatchObject({ isAvailable: false,
            reason: 'CONSENT_REQUIRED', sizeMB: Math.round(pins.totalBytes / 1_000_000) });
        await facade.terminate();
        vi.unstubAllGlobals();
    });
});

/**
 * Codex P1 on c72108a1 (modelPackage.ts): admission checked only that each reviewed Parakeet runtime pin was PRESENT in an
 * imported package's inventory, while ParakeetTdtEngine executes whichever file the profile's `runtimeBundleFile` names (and
 * the worker loads `wasmGlueFile`/`wasmBinaryFile` by role). A package could point an executable role at its `.onnx` weight
 * (carrying JavaScript under its own hash) and still pass sealing and verification, because the reviewed runtime sat unused
 * beside it. Each executable role is now bound to its reviewed pin.
 */
describe('an imported Parakeet package cannot choose which file the adapter executes', () => {
    beforeAll(() => { vi.stubGlobal('crypto', webcrypto); });
    afterAll(() => { vi.unstubAllGlobals(); });
    type Decode = Record<string, unknown>;
    const parakeetPackage = (change: (decode: Decode, files: Array<Record<string, unknown>>) => void = () => {}) => {
        const decode = { ...(candidate.execution.decode as unknown as Decode) };
        const files = candidate.assets.files!.map(f => ({ ...f })) as Array<Record<string, unknown>>;
        change(decode, files);
        return sealModelPackage({ schemaVersion: 1, kind: 'speaksharp-model-package', id: 'fixture:parakeet-roles',
            engine: candidate.engine, runtime: candidate.runtime, model: candidate.model,
            execution: { ...candidate.execution, decode } as never,
            assets: { files } as never, license: 'fixture declaration; no model copied' } as never);
    };
    const swap = (decode: Decode, a: string, b: string) => { const t = decode[a]; decode[a] = decode[b]; decode[b] = t; };

    it('the binding is exactly the built-in profile\'s executable roles', () => {
        const decode = candidate.execution.decode as unknown as Decode;
        expect(Object.fromEntries(Object.keys(PARAKEET_EXECUTABLE_ROLES).map(role => [role, decode[role]]))).toEqual(PARAKEET_EXECUTABLE_ROLES);
    });
    it('CONTROL: a package with the reviewed role mapping is admitted', async () => {
        expect(candidateFromPackage(await parakeetPackage(), 'fixture.json').engine).toBe('parakeet-tdt');
    });
    it.each([
        ['the runtime bundle swapped with the encoder weight', (d: Decode) => swap(d, 'runtimeBundleFile', 'encoderFile')],
        ['the WASM glue swapped with the decoder weight', (d: Decode) => swap(d, 'wasmGlueFile', 'decoderFile')],
        ['the WASM binary swapped with the configuration file', (d: Decode) => swap(d, 'wasmBinaryFile', 'configurationFile')],
    ])('REFUSED: %s', async (_label, change) => {
        await expect(parakeetPackage(change)).rejects.toThrow('UNSUPPORTED_PARAKEET_RUNTIME_ROLES');
    });
    it('Codex P2 on 1786e230: a role in a subdirectory is refused at admission, as the adapter\'s own profile check refuses it', async () => {
        const moved = (decode: Decode, files: Array<Record<string, unknown>>) => {
            const encoder = files.find(f => f.path === decode.encoderFile)!;
            encoder.path = 'weights/' + String(encoder.path);
            encoder.url = String(encoder.url).replace(/[^/]+$/, 'weights/' + String(decode.encoderFile));
            decode.encoderFile = encoder.path;
        };
        await expect(parakeetPackage(moved)).rejects.toThrow('UNSUPPORTED_PARAKEET_ASSET_LAYOUT');
        // The adapter refuses the same profile, so admitting it would leave a package that can never initialize.
        const decode = { ...(candidate.execution.decode as unknown as Decode), encoderFile: 'weights/encoder-model.int8.onnx' };
        expect(() => assertParakeetProfile(decode as never, { package: 'parakeet.js', version: '1.4.4', ortVersion: '1.24.1' } as never))
            .toThrow('Parakeet filenames must be distinct asset basenames');
    });
    it.each([
        ['an extra README beside the seven role files', (files: Array<Record<string, unknown>>) => {
            const vocab = files.find(f => f.path === 'vocab.txt')!;
            files.push({ ...vocab, path: 'README.txt', url: String(vocab.url).replace(/[^/]+$/, 'README.txt') });
        }],
        ['a second vocab.txt in a subdirectory', (files: Array<Record<string, unknown>>) => {
            const vocab = files.find(f => f.path === 'vocab.txt')!;
            files.push({ ...vocab, path: 'x/vocab.txt', url: String(vocab.url).replace(/[^/]+$/, 'x/vocab.txt') });
        }],
    ])('Review of 27607fb3: REFUSED at admission, since the engine requires exactly the seven role files: %s', async (_label, change) => {
        await expect(parakeetPackage((_decode, files) => change(files))).rejects.toThrow('UNSUPPORTED_PARAKEET_ASSET_LAYOUT');
    });
    it('REFUSED: the runtime role pointing at a renamed copy of a weight file, with the reviewed runtime still shipped beside it', async () => {
        await expect(parakeetPackage((decode, files) => {
            const encoder = files.find(f => f.path === decode.encoderFile)!;
            files.push({ ...encoder, path: 'runtime-payload.onnx', url: String(encoder.url).replace(/[^/]+$/, 'runtime-payload.onnx') });
            decode.runtimeBundleFile = 'runtime-payload.onnx';
        // Since the review of 27607fb3 the inventory must be exactly the seven role files, so the extra copy is refused even
        // before the role binding is checked.
        })).rejects.toThrow(/UNSUPPORTED_PARAKEET_(?:ASSET_LAYOUT|RUNTIME_ROLES)/);
    });
});
