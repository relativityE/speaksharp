/**
 * The registry's values are CONFIGURED provenance, so their only guarantee is that they match the things
 * they claim to describe. These tests are that guarantee: every version is checked against the installed
 * package, and every asset digest is recomputed from the committed pin table. Drift fails CI instead of
 * quietly re-identifying a model in a human A/B.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
    CANDIDATES, CANDIDATE_IDS, PRIVATE_STT_MODEL_IN_USE, UnknownCandidateError, UnusableCandidateError,
    activeCandidate, identityOf, isCompleteIdentity, resolveCandidate, type CandidateId,
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

    it('CASUALTY: a REGISTERED but browser-unusable candidate is refused, with the recorded reason', () => {
        // int8 is the case that matters: real, measured, and impossible to run in the backend we ship.
        // Without this it would be discovered at a user's first session, after the model download.
        expect(() => resolveCandidate('v4:base:int8')).toThrow(UnusableCandidateError);
        expect(() => resolveCandidate('v4:base:int8')).toThrow(/ONNX Runtime Web cannot create a session/);
    });

    it('every candidate marked unusable states WHY', () => {
        for (const id of CANDIDATE_IDS) {
            const { browser } = CANDIDATES[id];
            if (!browser.ok) expect(browser.reason, `${id} unusable without a reason`).toBeTruthy();
        }
    });

    it('POSITIVE CONTROL: usable candidates resolve', () => {
        for (const id of ['v2:base.en', 'v4:base:q4', 'moonshine:streaming-medium'] as CandidateId[]) {
            expect(resolveCandidate(id).id).toBe(id);
        }
    });
});

describe('the active candidate is a checked-in build-time decision', () => {
    it('CASUALTY: the default is still v2:base.en — Moonshine is REGISTERED, NOT ACTIVATED', () => {
        // Registering a candidate must never activate it. Changing this line is a Product Owner ruling
        // and has to appear in a diff, which is the entire point of a checked-in selector.
        expect(PRIVATE_STT_MODEL_IN_USE).toBe('v2:base.en');
        expect(activeCandidate().id).toBe('v2:base.en');
        expect(activeCandidate().engine).toBe('transformers-js');
    });

    it('the active candidate is always resolvable — a build cannot ship an unusable default', () => {
        expect(() => activeCandidate()).not.toThrow();
    });

    it('all four required candidates are registered', () => {
        expect([...CANDIDATE_IDS].sort()).toEqual(
            ['moonshine:streaming-medium', 'v2:base.en', 'v4:base:int8', 'v4:base:q4'],
        );
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
