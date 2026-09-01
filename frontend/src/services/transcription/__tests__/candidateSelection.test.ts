/**
 * #1263 — SELECTION IS ONE REVIEWABLE DECISION.
 *
 * These prove the selector itself: an unknown or unusable id is refused rather than substituted, the
 * active candidate comes from the CONFIG FILE rather than a constant, and an unapproved candidate needs
 * an explicit acknowledgement on an internal build. Attribution — what a run actually resolved to — is
 * proven separately in `candidateRegistry.test.ts`, because an intention must never be reported as
 * evidence.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    CANDIDATES, CANDIDATE_IDS, UnknownCandidateError, identityOf, isCompleteIdentity,
    type CandidateId,
} from '../candidateRegistry';
import {
    activeCandidate, assertBrowserUsable, resolveCandidate, isRunningUnapprovedCandidate,
    InactiveCandidateError, UnusableCandidateError, PRIVATE_STT_CONFIG_PATH,
} from '../candidateSelection';

/** Walk up from this file to the repo root (the directory owning pnpm-lock.yaml), then read. */
const REPO_ROOT = (() => {
    let dir = dirname(new URL(import.meta.url).pathname);
    for (let i = 0; i < 12; i += 1) {
        if (existsSync(join(dir, 'pnpm-lock.yaml'))) return dir;
        dir = dirname(dir);
    }
    throw new Error('repo root not found');
})();
const repoFile = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

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

    it('CASUALTY: the THREE contract candidates are selectable from config', () => {
        // The recorded product contract is Moonshine / v2 base.en / v4 distil-q4. A config that cannot
        // express all three makes the human comparison impossible, so this asserts the whole slate.
        expect(activeCandidate({ candidate: 'v2:base.en' }).id).toBe('v2:base.en');
        expect(activeCandidate({ candidate: 'v4:distil:q4' }).id).toBe('v4:distil:q4');
        // Moonshine additionally needs an INTERNAL build: it is selectable for comparison, not
        // shippable, and the two permissions are deliberately separate. #1381 activates it.
        expect(activeCandidate(
            { candidate: 'moonshine:streaming-medium', acknowledgeNotProductionReady: true },
            { VITE_INTERNAL_BUILD: 'true' },
        ).id).toBe('moonshine:streaming-medium');
    });

    it('CASUALTY: the benchmark controls FAIL CLOSED when configured', () => {
        // base_q4 and base_int8 are measured arms, not product candidates. int8 additionally has no
        // runtime variant at all, so selecting it could only ever run a DIFFERENT model under its id —
        // which is the defect this whole plane exists to prevent. Neither may boot silently.
        // Collected then asserted once: the loop reports WHICH control regressed without needing a
        // per-assertion message the lint rule disallows.
        const booted = ['v4:base:q4', 'v4:base:int8'].filter((id) => {
            try { activeCandidate({ candidate: id }); return true; } catch { return false; }
        });
        expect(booted).toEqual([]);
        const unexplained = ['v4:base:q4', 'v4:base:int8'].filter((id) => {
            try { activeCandidate({ candidate: id }); return true; } catch (e) {
                return !(e instanceof InactiveCandidateError) || !/benchmark control only/.test(String(e));
            }
        });
        expect(unexplained).toEqual([]);
    });

    it('the benchmark controls remain REGISTERED — they are still attribution targets', () => {
        // Refusing to RUN them must not erase them: a past or benchmark run that resolved base_q4 still
        // has to be attributable to base_q4 rather than to nothing.
        const unattributable = (['v4:base:q4', 'v4:base:int8'] as const).filter(
            (id) => !CANDIDATES[id] || !isCompleteIdentity(identityOf(CANDIDATES[id])),
        );
        expect(unattributable).toEqual([]);
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
        // and some ARE ineligible today, so the assertion above is not vacuous. This set is the
        // recorded contract: only v2 and distil-q4 may ship, Moonshine is pending #1381 activation, and
        // the two base controls are benchmark arms that selection refuses.
        expect(CANDIDATE_IDS.filter((id) => !CANDIDATES[id].activationReady))
            .toEqual(['v4:base:q4', 'v4:base:int8', 'moonshine:streaming-medium']);
        expect(CANDIDATE_IDS.filter((id) => CANDIDATES[id].activationReady))
            .toEqual(['v2:base.en', 'v4:distil:q4']);
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

describe('SWAPPING a candidate is a one-line config change', () => {
    /**
     * The point of the config plane: once the r3 results land, changing which model runs — a different
     * v4 variant, a different Moonshine size — must be editing one value, not an engineering task.
     * These prove the swap actually PROPAGATES rather than only changing an id.
     */
    it('CASUALTY: changing the config value changes engine, model, dtype AND assets', () => {
        const v2 = activeCandidate({ candidate: 'v2:base.en' });
        const distil = activeCandidate({ candidate: 'v4:distil:q4' });

        expect(v2.engine).not.toBe(distil.engine);
        expect(v2.model.id).not.toBe(distil.model.id);
        expect(v2.runtime.package).not.toBe(distil.runtime.package);
        expect(v2.assets.pinDigest).not.toBe(distil.assets.pinDigest);
        // A swap that changed the label but kept the bytes would be the worst possible outcome: a
        // session attributed to one model and decoded by another.
        expect(distil.model.device).toBe('webgpu');
    });

    it('CASUALTY: swapping between v4 variants changes the DECODER, not just the name', () => {
        // q4 and int8 share a repo and an encoder. If a swap between them did not change the decoder
        // precision, the config would be decorative. Read from the REGISTRY: both are benchmark
        // controls that selection refuses, and this asserts what distinguishes them as measured arms.
        const q4 = CANDIDATES['v4:base:q4'];
        const int8 = CANDIDATES['v4:base:int8'];
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
        expect(activeCandidate({ candidate: 'v4:distil:q4' }).id).toBe('v4:distil:q4');
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
    const SLOTS: CandidateId[] = ['v2:base.en', 'v4:distil:q4', 'moonshine:streaming-medium'];

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
        const after = activeCandidate({ candidate: 'v4:distil:q4' });
        // Same call, same code path, different everything that describes the model.
        expect(before.id).not.toBe(after.id);
        expect(before.model.id).not.toBe(after.model.id);
        expect(before.runtime.package).not.toBe(after.runtime.package);
    });
});

describe('the escape hatch requires an INTERNAL build, and fails closed without one', () => {
    const INTERNAL = { VITE_INTERNAL_BUILD: 'true' };
    const NOT_INTERNAL = {};

    it('CASUALTY: the acknowledgement is refused without an internal build', () => {
        // If a shipped config carried the acknowledgement, every user would receive an unvalidated
        // model — the guard would have become a silent bypass, worse than no guard.
        expect(() => activeCandidate(
            { candidate: 'moonshine:streaming-medium', acknowledgeNotProductionReady: true },
            NOT_INTERNAL,
        )).toThrow(/requires an INTERNAL build/);
    });

    it('CASUALTY: refused even for an APPROVED candidate, so it cannot lie dormant', () => {
        // Otherwise the acknowledgement survives in a shipped config as a latent bypass, waiting for
        // the candidate list to change underneath it.
        expect(() => activeCandidate(
            { candidate: 'v2:base.en', acknowledgeNotProductionReady: true },
            NOT_INTERNAL,
        )).toThrow(/requires an INTERNAL build/);
    });

    it('CASUALTY: it FAILS CLOSED — a forgotten flag refuses, it does not admit', () => {
        // The dangerous direction must be unreachable by omission. Running an unapproved candidate
        // requires SETTING a variable; forgetting one can only make the build safer.
        for (const env of [{}, { VITE_INTERNAL_BUILD: '' }, { VITE_INTERNAL_BUILD: 'false' },
            { VITE_INTERNAL_BUILD: '1' }, { VITE_INTERNAL_BUILD: true as unknown as string }]) {
            expect(() => activeCandidate(
                { candidate: 'moonshine:streaming-medium', acknowledgeNotProductionReady: true },
                env,
            )).toThrow(/requires an INTERNAL build/);
        }
    });

    it('POSITIVE CONTROL: an internal build runs the unapproved candidate — the ear test works', () => {
        // This is the whole point: comparing candidates on a real DEPLOYED build, without editing the
        // pinned production build command to do it.
        expect(activeCandidate(
            { candidate: 'moonshine:streaming-medium', acknowledgeNotProductionReady: true },
            INTERNAL,
        ).id).toBe('moonshine:streaming-medium');
    });

    it('the guard does NOT depend on build mode — a production-mode internal build still works', () => {
        // Keying on import.meta.env.PROD made the only route to a deployed ear test an edit to
        // vercel.json's pinned build command, weakening production to enable a test.
        expect(activeCandidate(
            { candidate: 'moonshine:streaming-medium', acknowledgeNotProductionReady: true },
            { ...INTERNAL, PROD: true },
        ).id).toBe('moonshine:streaming-medium');
    });

    it('an internal build WITHOUT the acknowledgement still refuses an unapproved candidate', () => {
        // Being internal is permission to opt in, not the opt-in itself.
        expect(() => activeCandidate(
            { candidate: 'moonshine:streaming-medium' }, INTERNAL,
        )).toThrow(/not approved as a production default/);
    });

    it('POSITIVE CONTROL: an ordinary production build runs the approved default', () => {
        expect(activeCandidate({ candidate: 'v2:base.en' }, { PROD: true }).id).toBe('v2:base.en');
    });
});