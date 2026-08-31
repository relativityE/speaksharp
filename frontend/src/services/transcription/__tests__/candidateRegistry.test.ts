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
    CANDIDATES, CANDIDATE_IDS, UnknownCandidateError, UnusableCandidateError,
    activeCandidate, assertBrowserUsable, candidateForRuntime, identityOf, isCompleteIdentity,
    resolveCandidate, isRunningUnapprovedCandidate, InactiveCandidateError, PRIVATE_STT_CONFIG_PATH,
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

describe('selection fails closed', () => {
    it('CASUALTY: an unknown candidate id is REFUSED', () => {
        expect(() => resolveCandidate('v4:base:q8')).toThrow(UnknownCandidateError);
        expect(() => resolveCandidate('')).toThrow(UnknownCandidateError);
        // The message must name what IS registered, or the failure is unactionable at boot.
        expect(() => resolveCandidate('nope')).toThrow(/registered: .*v2:base\.en/);
    });

    it('CASUALTY: a browser-unusable candidate is refused, with its recorded reason', () => {
        // Tested through the exported MECHANISM against a synthetic candidate, not by marking a real
        // one unusable. An earlier version asserted this against v4:base:int8, which pinned a WRONG
        // classification into the test suite: r9 ran int8 at executionBackend "browser_wasm" with
        // backendProven true and 23/23 decoded. Proving the guard must not require libelling a
        // candidate that works.
        const unusable = {
            ...CANDIDATES['v4:base:q4'],
            browser: { ok: false, reason: 'synthetic: cannot create a session' },
        };
        expect(() => assertBrowserUsable(unusable)).toThrow(UnusableCandidateError);
        expect(() => assertBrowserUsable(unusable)).toThrow(/cannot create a session/);
    });

    it('POSITIVE CONTROL: v4:base:int8 RESOLVES — it is browser-WASM capable', () => {
        // Guards the correction itself. r9: executionBackend "browser_wasm", backendProven true,
        // 23/23 decoded, every reliability counter zero; the earlier targeted run decoded 600/600.
        // Its accuracy being statistically indistinguishable from v2 is a SELECTION question, not a
        // technical-capability one, and must not be re-encoded as a boot-time rejection.
        expect(resolveCandidate('v4:base:int8').id).toBe('v4:base:int8');
        expect(CANDIDATES['v4:base:int8'].browser.ok).toBe(true);
    });

    it('every candidate marked unusable states WHY', () => {
        // Collected then asserted once, rather than an `expect` inside the branch: a conditional expect
        // silently asserts nothing when no candidate happens to be unusable.
        const unusableWithoutReason = CANDIDATE_IDS
            .filter((id) => !CANDIDATES[id].browser.ok && !CANDIDATES[id].browser.reason);
        expect(unusableWithoutReason).toEqual([]);
        // TODAY every registered candidate is browser-capable, so the rule above is vacuous here by
        // design — which is why the refusal mechanism is proven separately against a synthetic
        // candidate rather than by keeping a real one marked unusable.
        expect(CANDIDATE_IDS.filter((id) => !CANDIDATES[id].browser.ok)).toEqual([]);
    });

    it('POSITIVE CONTROL: usable candidates resolve', () => {
        for (const id of ['v2:base.en', 'v4:base:q4', 'moonshine:streaming-medium'] as CandidateId[]) {
            expect(resolveCandidate(id).id).toBe(id);
        }
    });
});

describe('the active candidate is a checked-in build-time decision', () => {
    it('CASUALTY: the configured candidate is still v2:base.en — nothing was activated', () => {
        // Registering a candidate must never activate it. Changing this is a Product Owner ruling and
        // has to appear as a diff in a file whose only job is that decision.
        expect(activeCandidate().id).toBe('v2:base.en');
        expect(activeCandidate().engine).toBe('transformers-js');
    });

    it('CASUALTY: selection comes from the CONFIG FILE, not a constant in this module', () => {
        // A constant here made the registry its own second control plane, which the PO rejected.
        const src = repoFile('frontend/src/services/transcription/candidateRegistry.ts');
        expect(src).not.toMatch(/export const PRIVATE_STT_MODEL_IN_USE/);
        expect(PRIVATE_STT_CONFIG_PATH).toBe('frontend/src/config/private-stt.config.json');
        const cfg = JSON.parse(repoFile(PRIVATE_STT_CONFIG_PATH)) as { candidate: string };
        expect(cfg.candidate).toBe('v2:base.en');
        expect(activeCandidate().id).toBe(cfg.candidate);
    });

    it('CASUALTY: ALL THREE human-test candidates are selectable from config', () => {
        // The Product Owner tests v2, int8 and moonshine side by side on the real path. A config that
        // cannot express the third makes the comparison impossible, so this asserts the whole slate.
        expect(activeCandidate({ candidate: 'v2:base.en' }).id).toBe('v2:base.en');
        expect(activeCandidate({ candidate: 'v4:base:int8' }).id).toBe('v4:base:int8');
        expect(activeCandidate({
            candidate: 'moonshine:streaming-medium', acknowledgeNotProductionReady: true,
        }).id).toBe('moonshine:streaming-medium');
    });

    it('CASUALTY: an unapproved candidate needs an EXPLICIT acknowledgement, never a silent pass', () => {
        // Two different questions: may this be the production default, and may this build run it for
        // comparison. Collapsing them forces a choice between shipping an unproven model and being
        // unable to test one — and testing is how a model becomes proven.
        expect(() => activeCandidate({ candidate: 'moonshine:streaming-medium' }))
            .toThrow(InactiveCandidateError);
        expect(() => activeCandidate({ candidate: 'moonshine:streaming-medium' }))
            .toThrow(/not approved as a production default/);
        // and the acknowledgement must be exactly true — no truthy string slipping through.
        expect(() => activeCandidate({
            candidate: 'moonshine:streaming-medium',
            acknowledgeNotProductionReady: 'yes' as unknown as boolean,
        })).toThrow(InactiveCandidateError);
    });

    it('a build running an unapproved candidate is FLAGGED, so evidence records it', () => {
        expect(isRunningUnapprovedCandidate({
            candidate: 'moonshine:streaming-medium', acknowledgeNotProductionReady: true,
        })).toBe(true);
        expect(isRunningUnapprovedCandidate({ candidate: 'v2:base.en' })).toBe(false);
    });

    it('CASUALTY: an activation-INELIGIBLE candidate fails boot, never silently substituted', () => {
        // Moonshine is registered and not ready: its live path was written against the non-streaming
        // API. Quietly falling back to v2 would attribute a v2 transcript to a moonshine session.
        expect(CANDIDATES['moonshine:streaming-medium'].activationReady).toBe(false);
        expect(CANDIDATES['moonshine:streaming-medium'].notReadyReason).toBeTruthy();
        expect(() => activeCandidate({ candidate: 'moonshine:streaming-medium' }))
            .toThrow(InactiveCandidateError);
        expect(() => activeCandidate({ candidate: 'moonshine:streaming-medium' }))
            .toThrow(/not approved as a production default/);
    });

    it('CASUALTY: a missing or unknown configured candidate fails closed', () => {
        expect(() => activeCandidate({})).toThrow(/names no candidate/);
        expect(() => activeCandidate({ candidate: '' })).toThrow(/names no candidate/);
        expect(() => activeCandidate({ candidate: 'v9:imaginary' })).toThrow(UnknownCandidateError);
    });

    it('every candidate that is NOT activation-ready states why', () => {
        // Collected then asserted once. A conditional expect asserts NOTHING on the day every
        // candidate happens to be ready, which is exactly when the rule stops being enforced.
        const unexplained = CANDIDATE_IDS.filter((id) => !CANDIDATES[id].activationReady && !CANDIDATES[id].notReadyReason);
        expect(unexplained).toEqual([]);
        // and one IS ineligible today, so the assertion above is not vacuous.
        expect(CANDIDATE_IDS.filter((id) => !CANDIDATES[id].activationReady)).toEqual(['moonshine:streaming-medium']);
    });

    it('the active candidate is always resolvable — a build cannot ship an unusable default', () => {
        expect(() => activeCandidate()).not.toThrow();
    });

    it('all four REQUIRED candidates are registered', () => {
        for (const id of ['v2:base.en', 'v4:base:int8', 'v4:base:q4', 'moonshine:streaming-medium']) {
            expect(CANDIDATE_IDS, `${id} missing`).toContain(id);
        }
    });

    it('v4:distil:q4 is also registered — because the shipping resolver can still select it', () => {
        // Not a finalist. Registered because a candidate the product can RUN but the registry cannot
        // DESCRIBE reproduces the very defect this registry closes: a session with no attributable
        // model. Registering it makes it identifiable, not preferred.
        expect(CANDIDATE_IDS).toContain('v4:distil:q4');
        expect(activeCandidate().id).not.toBe('v4:distil:q4');
        expect([...CANDIDATE_IDS].sort()).toEqual([
            'moonshine:streaming-medium', 'v2:base.en', 'v4:base:int8', 'v4:base:q4', 'v4:distil:q4',
        ]);
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

describe('SWAPPING a candidate is a one-line config change', () => {
    /**
     * The point of the config plane: once the r3 results land, changing which model runs — a different
     * v4 variant, a different Moonshine size — must be editing one value, not an engineering task.
     * These prove the swap actually PROPAGATES rather than only changing an id.
     */
    it('CASUALTY: changing the config value changes engine, model, dtype AND assets', () => {
        const v2 = activeCandidate({ candidate: 'v2:base.en' });
        const int8 = activeCandidate({ candidate: 'v4:base:int8' });

        expect(v2.engine).not.toBe(int8.engine);
        expect(v2.model.id).not.toBe(int8.model.id);
        expect(v2.runtime.package).not.toBe(int8.runtime.package);
        expect(v2.assets.pinDigest).not.toBe(int8.assets.pinDigest);
        // A swap that changed the label but kept the bytes would be the worst possible outcome: a
        // session attributed to one model and decoded by another.
        expect(int8.model.dtype?.decoder_model_merged).toBe('int8');
    });

    it('CASUALTY: swapping between v4 variants changes the DECODER, not just the name', () => {
        // q4 and int8 share a repo and an encoder. If a swap between them did not change the decoder
        // precision, the config would be decorative.
        const q4 = activeCandidate({ candidate: 'v4:base:q4' });
        const int8 = activeCandidate({ candidate: 'v4:base:int8' });
        expect(q4.model.id).toBe(int8.model.id);
        expect(q4.model.dtype?.decoder_model_merged).toBe('q4');
        expect(int8.model.dtype?.decoder_model_merged).toBe('int8');
        expect(q4.assets.pinDigest).not.toBe(int8.assets.pinDigest);
    });

    it('the three human-test slots are all registered and describable', () => {
        // v2 incumbent, the v4 representative, and the Moonshine prospect. Moonshine is describable but
        // not activatable, which is the distinction that lets us build against it before it is proven.
        for (const id of ['v2:base.en', 'v4:base:int8', 'moonshine:streaming-medium'] as CandidateId[]) {
            const c = CANDIDATES[id];
            expect(c, `${id} missing`).toBeTruthy();
            expect(isCompleteIdentity(identityOf(c)), `${id} not attributable`).toBe(true);
            expect(c.assets.pinDigest, `${id} has no asset digest`).toBeTruthy();
        }
        expect(activeCandidate({ candidate: 'v4:base:int8' }).id).toBe('v4:base:int8');
        expect(() => activeCandidate({ candidate: 'moonshine:streaming-medium' })).toThrow(/not approved as a production default/);
    });
});

describe('DROP-IN property — every candidate resolves wholly from its registry entry', () => {
    /**
     * The swap is only one line if NOTHING candidate-specific lives outside the registry. The moment a
     * branch somewhere says "if moonshine then…", r3 naming a different arm becomes a rebuild instead
     * of a config edit.
     *
     * This builds each slot purely from a config value and checks that every property a caller needs —
     * engine, model, dtype, device, runtime, assets — comes back from the entry, with no field left for
     * something else to supply.
     */
    const SLOTS: CandidateId[] = ['v2:base.en', 'v4:base:int8', 'moonshine:streaming-medium'];

    it('CASUALTY: each slot resolves engine/model/dtype/device/runtime/assets from config alone', () => {
        for (const id of SLOTS) {
            // resolveCandidate is the config path minus the activation gate, so an unshippable
            // candidate is still fully describable — which is what lets us build against it now.
            const c = resolveCandidate(id);
            const entry = CANDIDATES[id];
            expect(c.engine, `${id} engine`).toBe(entry.engine);
            expect(c.model.id, `${id} model`).toBe(entry.model.id);
            expect(c.model.dtype, `${id} dtype`).toEqual(entry.model.dtype);
            expect(c.model.device, `${id} device`).toBe(entry.model.device);
            expect(c.model.sampleRateHz, `${id} sample rate`).toBe(entry.model.sampleRateHz);
            expect(c.runtime, `${id} runtime`).toEqual(entry.runtime);
            expect(c.assets.pinDigest, `${id} assets`).toBe(entry.assets.pinDigest);
        }
    });

    it('CASUALTY: no candidate id is hardcoded outside the registry and its config', () => {
        // A branch keyed on a specific candidate elsewhere in the STT tree is what turns a one-line
        // swap back into an engineering task.
        const offenders: string[] = [];
        const scan = (rel: string) => {
            const body = repoFile(rel);
            for (const id of SLOTS) {
                if (body.includes(`'${id}'`) || body.includes(`"${id}"`)) offenders.push(`${rel} :: ${id}`);
            }
        };
        scan('frontend/src/services/transcription/engines/PrivateSTT.ts');
        scan('frontend/src/services/transcription/utils/privateModelFlag.ts');
        expect(offenders, 'candidate ids referenced outside the registry/config').toEqual([]);
    });

    it('swapping a slot changes only the config value — the registry supplies the rest', () => {
        const before = activeCandidate({ candidate: 'v2:base.en' });
        const after = activeCandidate({ candidate: 'v4:base:int8' });
        // Same call, same code path, different everything that describes the model.
        expect(before.id).not.toBe(after.id);
        expect(before.model.id).not.toBe(after.model.id);
        expect(before.runtime.package).not.toBe(after.runtime.package);
    });
});

describe('the internal escape hatch is not a production backdoor', () => {
    it('CASUALTY: a PRODUCTION build refuses the acknowledgement outright', () => {
        // If the config shipped with the acknowledgement set, every user would receive an unvalidated
        // model — the guard would have become a silent bypass, which is worse than no guard.
        expect(() => activeCandidate(
            { candidate: 'moonshine:streaming-medium', acknowledgeNotProductionReady: true },
            { PROD: true },
        )).toThrow(/PRODUCTION build refuses acknowledgeNotProductionReady/);
    });

    it('CASUALTY: production refuses it even for a candidate that IS approved', () => {
        // The acknowledgement must never appear in a shipped config at all, approved candidate or not,
        // or it survives as a latent bypass waiting for the candidate list to change.
        expect(() => activeCandidate(
            { candidate: 'v2:base.en', acknowledgeNotProductionReady: true },
            { PROD: true },
        )).toThrow(/PRODUCTION build refuses/);
    });

    it('POSITIVE CONTROL: production runs an approved candidate normally', () => {
        expect(activeCandidate({ candidate: 'v2:base.en' }, { PROD: true }).id).toBe('v2:base.en');
    });

    it('POSITIVE CONTROL: a non-production build may use the acknowledgement', () => {
        expect(activeCandidate(
            { candidate: 'moonshine:streaming-medium', acknowledgeNotProductionReady: true },
            { PROD: false },
        ).id).toBe('moonshine:streaming-medium');
    });
});
