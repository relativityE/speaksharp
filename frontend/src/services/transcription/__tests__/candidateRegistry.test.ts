/**
 * The registry's values are CONFIGURED provenance, so their only guarantee is that they match the things
 * they claim to describe. These tests are that guarantee: every version is checked against the installed
 * package, and every asset digest is recomputed from the committed pin table. Drift fails CI instead of
 * quietly re-identifying a model in a human A/B.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    CANDIDATES, CANDIDATE_IDS, UnknownCandidateError,
    candidateForRuntime, identityOf, isCompleteIdentity,
    type CandidateId,
} from '../candidateRegistry';

/** Walk up from this file to the repo root (the directory owning pnpm-lock.yaml), then read. */
const REPO_ROOT = (() => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 12; i++) {
        if (existsSync(join(dir, 'pnpm-lock.yaml'))) return dir;
        dir = dirname(dir);
    }
    throw new Error('repo root not found from the test file');
})();
const repoFile = (p: string): string => readFileSync(join(REPO_ROOT, p), 'utf8');
const installedVersion = (pkg: string): string =>
    (JSON.parse(repoFile(`node_modules/${pkg}/package.json`)) as { version: string }).version;

describe('configured runtime versions match the INSTALLED packages', () => {
    it('CASUALTY: every candidate runtime version equals the locked/installed version', () => {
        // A semver range or a stale hand-typed version would attribute a session to a runtime that never
        // ran. The registry must name the exact bytes the lockfile resolved.
        for (const id of CANDIDATE_IDS) {
            const { runtime } = CANDIDATES[id];
            expect(runtime.version, `${id} runtime version`).toBe(installedVersion(runtime.package));
            expect(runtime.version, `${id} must be exact, not a range`).toMatch(/^\d+\.\d+\.\d+/);
        }
    });
});

describe('configured asset identity is recomputed, never trusted', () => {
    it('CASUALTY: the moonshine pin digest matches a digest recomputed from the committed pin table', () => {
        const c = CANDIDATES['moonshine:streaming-medium'];
        const pins = JSON.parse(repoFile(c.assets.pinSource!)) as {
            assets: Record<string, { sha256: string }>;
        };
        const keys = Object.keys(pins.assets).filter((k) => k.includes(c.model.id)).sort();
        const h = createHash('sha256');
        for (const k of keys) h.update(`${k}:${pins.assets[k].sha256}\n`);

        expect(keys.length).toBe(c.assets.componentCount);
        expect(h.digest('hex')).toBe(c.assets.pinDigest);
    });

    it('CASUALTY: every whisper candidate digest recomputes from the committed HF pin table', () => {
        // Each v4 candidate is bound to the EXACT files it loads — the same encoder with a different
        // decoder precision — so q4 and int8 must not share a digest.
        const files = (repo: string, decoder: string): string[] => [
            'config.json', 'generation_config.json', 'preprocessor_config.json',
            'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model.onnx', `onnx/${decoder}`,
        ].map((f) => `${repo}/resolve/main/${f}`);

        const expected: [string, string[]][] = [
            ['v4:base:q4', files('onnx-community/whisper-base.en', 'decoder_model_merged_q4.onnx')],
            ['v4:base:int8', files('onnx-community/whisper-base.en', 'decoder_model_merged_int8.onnx')],
            ['v4:distil:q4', files('onnx-community/distil-small.en', 'decoder_model_merged_q4.onnx')],
        ];

        for (const [id, keys] of expected) {
            const c = CANDIDATES[id as CandidateId];
            const pins = JSON.parse(repoFile(c.assets.pinSource!)) as { assets: Record<string, string> };
            const h = createHash('sha256');
            for (const k of [...keys].sort()) {
                expect(pins.assets[k], `${id} missing pin for ${k}`).toBeTruthy();
                h.update(`${k}:${pins.assets[k]}\n`);
            }
            expect(c.assets.componentCount, `${id} component count`).toBe(keys.length);
            expect(h.digest('hex'), `${id} pin digest`).toBe(c.assets.pinDigest);
        }
        // q4 and int8 differ only by decoder precision; identical digests would mean one model twice.
        expect(CANDIDATES['v4:base:q4'].assets.pinDigest)
            .not.toBe(CANDIDATES['v4:base:int8'].assets.pinDigest);
    });

    it('CASUALTY: v2 is digested from the SELF-HOSTED files this product ships', () => {
        // v2 is not unattributable and never was — its bytes are in the repo. The digest is recomputed
        // here from frontend/public/models/whisper-base.en over the complete file set, so replacing or
        // re-quantising a shipped model file fails CI instead of silently changing what "v2" means.
        const c = CANDIDATES['v2:base.en'];
        expect(c.assets.provenance).toBe('self_hosted');
        expect(c.assets.pinSource).toBe('frontend/public/models/whisper-base.en');

        const root = join(REPO_ROOT, c.assets.pinSource!);
        const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true })
            .flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
        const files = walk(root).sort();
        let bytes = 0;
        const h = createHash('sha256');
        for (const f of files) {
            const buf = readFileSync(f);
            bytes += buf.length;
            h.update(`${relative(root, f)}:${createHash('sha256').update(buf).digest('hex')}\n`);
        }
        expect(files.length).toBe(c.assets.componentCount);
        expect(bytes).toBe(c.assets.totalBytes);
        expect(h.digest('hex')).toBe(c.assets.pinDigest);
    });

    it('every candidate has a digest AND a stated provenance', () => {
        for (const id of CANDIDATE_IDS) {
            const a = CANDIDATES[id].assets;
            expect(a.pinDigest, `${id} has no asset digest`).toBeTruthy();
            expect(a.provenance, `${id} has no stated provenance`).toBeTruthy();
        }
    });

    it('the pinned revision appears in the pinned component paths', () => {
        // Guards the pairing: a digest can match while the revision string names a different set.
        const c = CANDIDATES['moonshine:streaming-medium'];
        const pins = JSON.parse(repoFile(c.assets.pinSource!)) as { assets: Record<string, unknown> };
        const matching = Object.keys(pins.assets)
            .filter((k) => k.includes(c.model.id) && k.includes(c.model.revision!));
        expect(matching.length).toBe(c.assets.componentCount);
    });
});

describe('configured identity is complete, and completeness is enforced', () => {
    it('CASUALTY: every registered candidate yields a COMPLETE identity', () => {
        // An incomplete identity is what makes a human A/B unattributable, which is the defect this
        // registry exists to close. It must be impossible to register a candidate that cannot be
        // attributed — including int8, which is unusable but must still be describable.
        for (const id of CANDIDATE_IDS) {
            expect(isCompleteIdentity(identityOf(CANDIDATES[id])), `${id}`).toBe(true);
        }
    });

    it('CASUALTY: a missing runtime version or model id makes the identity INCOMPLETE', () => {
        const good = identityOf(CANDIDATES['v2:base.en']);
        expect(isCompleteIdentity(good)).toBe(true);
        expect(isCompleteIdentity({ ...good, configuredRuntime: { package: 'x', version: '' } })).toBe(false);
        expect(isCompleteIdentity({ ...good, configuredModel: { ...good.configuredModel, id: '' } })).toBe(false);
        expect(isCompleteIdentity({ ...good, configuredModel: { ...good.configuredModel, sampleRateHz: 0 } })).toBe(false);
        expect(isCompleteIdentity(null)).toBe(false);
    });

    it('identity separates CONFIGURED provenance from observed execution', () => {
        // There is no observed field on this object by construction. Init success, first decode and the
        // resolved backend are recorded by the engine, because merging them here is how a configured
        // default gets reported as though it were measured.
        const identity = identityOf(CANDIDATES['moonshine:streaming-medium']);
        expect(Object.keys(identity).every((k) => !/observed|init|decode|backend/i.test(k))).toBe(true);
        expect(identity.configuredRuntime.package).toBe('@moonshine-ai/moonshine-wasm');
        expect(identity.configuredModel.revision).toBe('quantized_26_07_30');
    });

    it('CASUALTY: the registry is DEEP-frozen — nested values cannot be mutated', () => {
        // Object.freeze is shallow, so `CANDIDATES[id].runtime.version = 'x'` silently succeeded and a
        // configured identity could be rewritten at runtime by any caller.
        expect(Object.isFrozen(CANDIDATES['v4:base:q4'].runtime)).toBe(true);
        expect(Object.isFrozen(CANDIDATES['v4:base:q4'].model)).toBe(true);
        expect(Object.isFrozen(CANDIDATES['v4:base:q4'].assets)).toBe(true);
        expect(Object.isFrozen(CANDIDATES['v4:base:q4'].model.dtype)).toBe(true);
    });

    it('identity is a COPY — a caller cannot mutate the registry through it', () => {
        const identity = identityOf(CANDIDATES['v2:base.en']);
        identity.configuredRuntime.version = 'tampered';
        expect(CANDIDATES['v2:base.en'].runtime.version).not.toBe('tampered');
    });
});

describe('every candidate carries the fields a session needs', () => {
    it('model id, sample rate, and an engine are present on all four', () => {
        for (const id of CANDIDATE_IDS) {
            const c = CANDIDATES[id];
            expect(c.model.id, `${id} model id`).toBeTruthy();
            expect(c.model.sampleRateHz, `${id} sample rate`).toBe(16_000);
            expect(c.engine, `${id} engine`).toBeTruthy();
            expect(c.runtime.package, `${id} runtime package`).toBeTruthy();
        }
    });

    it('the two v4 candidates differ ONLY in decoder precision', () => {
        // If these two ever collapse to the same dtype, the int8-vs-q4 comparison silently becomes one
        // model measured twice — the q8/int8 alias trap the benchmark already hit once.
        const q4 = CANDIDATES['v4:base:q4'], int8 = CANDIDATES['v4:base:int8'];
        expect(q4.model.id).toBe(int8.model.id);
        expect(q4.model.dtype?.decoder_model_merged).toBe('q4');
        expect(int8.model.dtype?.decoder_model_merged).toBe('int8');
        expect(q4.model.dtype?.decoder_model_merged).not.toBe(int8.model.dtype?.decoder_model_merged);
    });
});

describe('a PROVIDER-ONLY identity check cannot separate the v4 candidates', () => {
    // The live cache proof identifies the running model by reconstructing a full candidate id from
    // what the engine published. An implementation that compared only `provider` would pass while a
    // DIFFERENT model decoded the take, because all three v4 candidates share one provider — and the
    // human comparison would then attribute a base_q4 recording to distil.
    const V4 = 'transformers-js-v4';

    it('CASUALTY: changing ONLY the variant changes the candidate id', () => {
        const base = candidateForRuntime({ engineType: V4, variant: 'base_q4' });
        const distil = candidateForRuntime({ engineType: V4, variant: 'distil_q4' });
        expect(base).toBe('v4:base:q4');
        expect(distil).toBe('v4:distil:q4');
        expect(base).not.toBe(distil);
    });

    it('CASUALTY: the provider ALONE is identical across those candidates', () => {
        // Stated explicitly so the reason the variant is required cannot be optimised away later.
        expect(CANDIDATES['v4:base:q4'].engine).toBe(V4);
        expect(CANDIDATES['v4:distil:q4'].engine).toBe(V4);
        expect(CANDIDATES['v4:base:int8'].engine).toBe(V4);
    });

    it('CASUALTY: two base variants differing only in DECODER PRECISION are separated', () => {
        expect(candidateForRuntime({ engineType: V4, variant: 'base_q4', decoderDtype: 'q4' })).toBe('v4:base:q4');
        expect(candidateForRuntime({ engineType: V4, variant: 'base_int8', decoderDtype: 'int8' })).toBe('v4:base:int8');
    });

    it('an unrecognised pair is REFUSED, never defaulted to a provider-level guess', () => {
        expect(() => candidateForRuntime({ engineType: V4, variant: 'base_q9' })).toThrow(UnknownCandidateError);
    });
});

describe('RESOLVED runtime state maps to a candidate — the original defect', () => {
    it('CASUALTY: a v4 session running base_q4 is NOT attributed from a default constant', () => {
        // The defect: getMetadata() read PRIV_STT_V4_DEFAULT_VARIANT, so whatever ran was recorded as
        // base_q4. Mapping must come from the RESOLVED variant, which was available all along.
        expect(candidateForRuntime({ engineType: 'transformers-js-v4', variant: 'base_q4', decoderDtype: 'q4' })).toBe('v4:base:q4');
        expect(candidateForRuntime({ engineType: 'transformers-js-v4', variant: 'base_int8', decoderDtype: 'int8' })).toBe('v4:base:int8');
        expect(candidateForRuntime({ engineType: 'transformers-js-v4', variant: 'distil_q4' })).toBe('v4:distil:q4');
        expect(candidateForRuntime({ engineType: 'transformers-js', variant: null })).toBe('v2:base.en');
    });

    it('CASUALTY: distil_q4 must NOT be attributed as base_q4', () => {
        // Exactly the mis-attribution that made a human A/B unusable, stated as its own casualty.
        expect(candidateForRuntime({ engineType: 'transformers-js-v4', variant: 'distil_q4' })).not.toBe('v4:base:q4');
    });

    it('CASUALTY: an unrecognised variant is REFUSED, never defaulted', () => {
        expect(() => candidateForRuntime({ engineType: 'transformers-js-v4', variant: null })).toThrow(UnknownCandidateError);
        expect(() => candidateForRuntime({ engineType: 'mock', variant: null })).toThrow(UnknownCandidateError);
        expect(() => candidateForRuntime({ engineType: null, variant: null })).toThrow(UnknownCandidateError);
    });

    it('every id it can return is a REGISTERED candidate', () => {
        for (const st of [
            { engineType: 'transformers-js', variant: null },
            { engineType: 'transformers-js-v4', variant: 'base_q4', decoderDtype: 'q4' },
            { engineType: 'transformers-js-v4', variant: 'base_int8', decoderDtype: 'int8' },
            { engineType: 'transformers-js-v4', variant: 'distil_q4' },
        ]) {
            expect(CANDIDATE_IDS).toContain(candidateForRuntime(st));
        }
    });
});

describe('a Moonshine session is attributed by ARCH, not by provider', () => {
    it('CASUALTY: the medium arch resolves to the medium candidate', () => {
        expect(candidateForRuntime({
            engineType: 'moonshine-streaming', variant: 'MOONSHINE_STREAMING_MEDIUM',
        })).toBe('moonshine:streaming-medium');
    });

    it('CASUALTY: an arch no candidate describes is REFUSED, not mapped to the only one registered', () => {
        // `moonshine:streaming-medium` is currently the sole registered Moonshine candidate, so mapping
        // the provider straight to it would pass every test written today and silently record every
        // SmallStreaming session as medium the day someone runs one. That is the arm the human test is
        // comparing, so a wrong label there invalidates the comparison rather than merely mislabelling
        // a row.
        for (const variant of ['MOONSHINE_STREAMING_SMALL', 'MOONSHINE_STREAMING_TINY', null]) {
            expect(() => candidateForRuntime({ engineType: 'moonshine-streaming', variant }))
                .toThrow(UnknownCandidateError);
        }
    });

    it('CASUALTY: the provider alone never yields an identity', () => {
        expect(() => candidateForRuntime({ engineType: 'moonshine-streaming', variant: undefined as never }))
            .toThrow(/refusing to attribute/);
    });
});
