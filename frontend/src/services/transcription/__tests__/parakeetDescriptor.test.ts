import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANDIDATES, identityOf, assetsVerified, isQualificationGrade } from '../candidateRegistry';
import { resolveCandidate } from '../candidateSelection';
import { assetRequestsFor, resolveCandidateAssetUrl } from '../candidateAssetRequests';
import { COMPARISON_CANDIDATE_IDS } from '../runtimeCandidateSwitch';
import { getDefaultProviderForMode, getProviderEntry } from '../providers/sttProviderConfig';
import { resolvePrivateAssignment, buildEngineVersion } from '../privateTelemetry';
import { requiredParakeetFiles } from '../engines/parakeet/contracts';
import pins from '../engines/parakeet/assetPins.json';

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
            if (file.url.startsWith('https://')) expect(file.url).toContain(`/resolve/${pins.revision}/`);
            else expect(file.url).toMatch(/^\/models\/parakeet-runtime\/1\.4\.4-ort1\.24\.1\//);
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
