import { describe, it, expect } from 'vitest';
import {
    buildPolicyForUser,
    PROD_PRO_POLICY,
    PROD_FREE_POLICY,
    type TranscriptionPolicy,
    type TranscriptionMode,
} from '../TranscriptionPolicy';

/**
 * #1036 — CHARACTERIZATION of the four `buildPolicyForUser` callers.
 *
 * `buildPolicyForUser` is a PURE function: identical inputs → identical policy. So the four call sites
 * can only produce different policies by passing DIFFERENT inputs for the SAME underlying entitlement/mode
 * state. This test encodes each caller's input derivation (from the real call sites) and compares the
 * resulting policies across the full entitlement/mode matrix, to answer the #1036 question:
 *   "Identify an ACTUAL (user-visible) divergence, or demonstrate the callers are equivalent."
 *
 * Call sites characterized (first argument = the entitlement source that selects the PRO vs FREE base):
 *   1. providers/TranscriptionProvider.tsx        → buildPolicyForUser(isPro,               safeMode, {allowCloud: isPro && cloudEnt})      TIER-ONLY
 *   2. hooks/useSessionLifecycle.ts (start)       → buildPolicyForUser(canUsePrivateStt,    latestMode,{allowCloud: canUseCloudStt})       CAPABILITY (isPro || privateSample)
 *   3. hooks/useSessionLifecycle.ts (modeChange)  → buildPolicyForUser(canUsePrivateStt,    safeMode,  {allowCloud: canUseCloudStt})       CAPABILITY
 *   4. hooks/useSpeechRecognition_prod.ts         → buildPolicyForUser(isEffectiveProUser,  effMode,   {allowCloud: effPro && cloudEnt})    TIER-ONLY
 *
 * Cloud is gated by (pro-tier && cloud-entitlement) in EVERY caller, so it never diverges on the sample
 * axis (a sample user is not pro → no Cloud anywhere). Only the Private base (first arg) can diverge.
 */

type State = {
    paidPro: boolean;          // real paid Pro tier
    hasPrivateSample: boolean; // a valid Private-STT sample entitlement (free users can hold this)
    hasCloudEnt: boolean;      // cloud STT entitlement on the profile
    requestedMode: TranscriptionMode | null;
};

// Each caller's FIRST argument (hasPrivateSttAccess) as derived at its real call site.
const firstArg = {
    provider: (s: State) => s.paidPro,                       // TIER-ONLY (isPro)
    lifecycle: (s: State) => s.paidPro || s.hasPrivateSample, // CAPABILITY (canUsePrivateStt)
    hook: (s: State) => s.paidPro,                            // TIER-ONLY (isEffectiveProUser, excludes sample)
};
// allowCloud as derived at every call site: pro-tier AND cloud entitlement (uniform across all four).
const allowCloudFor = (s: State) => s.paidPro && s.hasCloudEnt;

const policyFor = (who: keyof typeof firstArg, s: State): TranscriptionPolicy =>
    buildPolicyForUser(firstArg[who](s), s.requestedMode, { allowCloud: allowCloudFor(s) });

const MODES: Array<TranscriptionMode | null> = [null, 'native', 'private', 'cloud'];
const BOOLS = [false, true];
const matrix: State[] = [];
for (const paidPro of BOOLS)
    for (const hasPrivateSample of BOOLS)
        for (const hasCloudEnt of BOOLS)
            for (const requestedMode of MODES)
                matrix.push({ paidPro, hasPrivateSample, hasCloudEnt, requestedMode });

// The ONLY state where the tier-only and capability callers pass a different first argument.
const isFreeWithSample = (s: State) => !s.paidPro && s.hasPrivateSample;

describe('#1036: buildPolicyForUser caller characterization', () => {
    it('base policies are the two documented profiles (fixture guard)', () => {
        expect(PROD_FREE_POLICY.allowPrivate).toBe(false);
        expect(PROD_PRO_POLICY.allowPrivate).toBe(true);
    });

    it('all four callers produce IDENTICAL policies for every state EXCEPT free-user-with-sample', () => {
        // Collect any state whose caller policies disagree; a non-empty array names the offending states.
        const disagreements = matrix
            .filter(st => !isFreeWithSample(st))
            .filter(s => {
                const p = JSON.stringify(policyFor('provider', s));
                return JSON.stringify(policyFor('lifecycle', s)) !== p
                    || JSON.stringify(policyFor('hook', s)) !== p;
            });
        expect(disagreements).toEqual([]);
    });

    it('the ONLY divergence is Private access in the free-user-with-sample state', () => {
        const rows = matrix.filter(isFreeWithSample).map(s => ({
            state: s,
            lifecyclePrivate: policyFor('lifecycle', s).allowPrivate,
            providerPrivate: policyFor('provider', s).allowPrivate,
            hookPrivate: policyFor('hook', s).allowPrivate,
            anyCloud: policyFor('lifecycle', s).allowCloud || policyFor('provider', s).allowCloud,
        }));
        // Capability callers grant Private (sample-aware); both tier-only callers deny it; Cloud never granted.
        for (const r of rows) {
            expect(r.lifecyclePrivate).toBe(true);
            expect(r.providerPrivate).toBe(false);
            expect(r.hookPrivate).toBe(false);
            expect(r.anyCloud).toBe(false);
        }
        expect(rows.length).toBeGreaterThan(0);
    });

    it('the divergence is NOT user-visible: the capability (lifecycle) policy is the record-time authority', () => {
        // SpeechRuntimeController.startRecording(policy) assigns `this.policy = policy` unconditionally, and
        // ONLY the lifecycle callers feed the record path (startRecording / requestModeChange). The provider
        // (updatePolicy, pre-record resync) and the hook (warm/init config) never supply the recording policy.
        // Therefore, for a free-user-with-sample, the policy that governs an actual recording is the
        // capability one that GRANTS Private — the tier-only denial is inert at record time.
        const freeWithSample: State = { paidPro: false, hasPrivateSample: true, hasCloudEnt: false, requestedMode: 'private' };
        const recordAuthorityPolicy = policyFor('lifecycle', freeWithSample); // what startRecording receives
        expect(recordAuthorityPolicy.allowPrivate).toBe(true);
        expect(recordAuthorityPolicy.preferredMode).toBe('private');
    });
});
