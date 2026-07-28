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
 * `buildPolicyForUser` is a PURE function, so the four call sites can only produce different policies by
 * passing different inputs for the same state. This test models each caller's REAL input derivation — the
 * entitlement source (first arg) AND the requested-mode normalization — from the actual call sites, then
 * runs the full (paidPro × privateSample × cloudEnt × requestedMode) matrix.
 *
 * Call sites (entitlement source + how they normalize the mode for a NON-pro user):
 *   1. providers/TranscriptionProvider.tsx      → first=isPro (TIER);   non-pro mode → null
 *   2. hooks/useSessionLifecycle.ts (start)     → first=canUsePrivateStt (CAPABILITY = isPro||sample); mode = requested (cloud→native if no cloud)
 *   3. hooks/useSessionLifecycle.ts (modeChange)→ first=canUsePrivateStt (CAPABILITY);                  mode = requested (cloud→native if no cloud)
 *   4. hooks/useSpeechRecognition_prod.ts       → first=isEffectiveProUser (TIER); non-pro mode → 'native'
 *
 * FINDING (see assertions): the callers are NOT policy-identical — they diverge in two ways:
 *   (a) Private access for a free-user-with-sample (capability grants, tier-only deny), and
 *   (b) preferredMode / allowFallback for a non-pro user with a non-native selected mode (provider→null,
 *       hook→'native', lifecycle→requested).
 * BOTH divergences are INERT because only the lifecycle callers feed the record path and
 * `SpeechRuntimeController.startRecording` makes the lifecycle policy the sole record-time authority —
 * proven directly in `SpeechRuntimeController.test.ts` ("#1036: record-time authority ...").
 * So there is no USER-VISIBLE inconsistency and no selector refactor is warranted.
 */

type State = {
    paidPro: boolean;
    hasPrivateSample: boolean;
    hasCloudEnt: boolean;
    requestedMode: TranscriptionMode | null;
};

const cloudAllowed = (s: State) => s.paidPro && s.hasCloudEnt; // uniform gate in every caller
const demoteCloud = (m: TranscriptionMode | null, allowCloud: boolean, to: TranscriptionMode | null) =>
    m === 'cloud' && !allowCloud ? to : m;

// Faithful per-caller derivation of the (firstArg, uiMode, allowCloud) actually passed to buildPolicyForUser.
const callers = {
    provider: (s: State) => {
        const isPro = s.paidPro;
        const allowCloud = cloudAllowed(s);
        const requested = isPro ? s.requestedMode : null;       // non-pro → null
        const mode = demoteCloud(requested, allowCloud, 'private');
        return buildPolicyForUser(isPro, mode, { allowCloud });
    },
    hook: (s: State) => {
        const isPro = s.paidPro;
        const allowCloud = cloudAllowed(s);
        const mode = isPro ? demoteCloud(s.requestedMode, allowCloud, 'private') : 'native'; // non-pro → 'native'
        return buildPolicyForUser(isPro, mode, { allowCloud });
    },
    lifecycle: (s: State) => {
        const canUsePrivate = s.paidPro || s.hasPrivateSample; // CAPABILITY
        const allowCloud = cloudAllowed(s);
        const mode = demoteCloud(s.requestedMode, allowCloud, 'native'); // cloud→default('native'), else requested
        return buildPolicyForUser(canUsePrivate, mode, { allowCloud });
    },
} satisfies Record<string, (s: State) => TranscriptionPolicy>;

const MODES: Array<TranscriptionMode | null> = [null, 'native', 'private', 'cloud'];
const BOOLS = [false, true];
const matrix: State[] = [];
for (const paidPro of BOOLS)
    for (const hasPrivateSample of BOOLS)
        for (const hasCloudEnt of BOOLS)
            for (const requestedMode of MODES)
                matrix.push({ paidPro, hasPrivateSample, hasCloudEnt, requestedMode });

const isFreeWithSample = (s: State) => !s.paidPro && s.hasPrivateSample;

describe('#1036: buildPolicyForUser caller characterization', () => {
    it('base policies are the two documented profiles (fixture guard)', () => {
        expect(PROD_FREE_POLICY.allowPrivate).toBe(false);
        expect(PROD_PRO_POLICY.allowPrivate).toBe(true);
    });

    it('allowNative and allowCloud NEVER diverge across the four callers', () => {
        const nativeOrCloudDisagreements = matrix.filter(s => {
            const p = callers.provider(s), h = callers.hook(s), l = callers.lifecycle(s);
            return new Set([p.allowNative, h.allowNative, l.allowNative]).size !== 1
                || new Set([p.allowCloud, h.allowCloud, l.allowCloud]).size !== 1;
        });
        expect(nativeOrCloudDisagreements).toEqual([]);
        // Cloud is granted iff paidPro && cloudEnt, uniformly.
        for (const s of matrix) expect(callers.lifecycle(s).allowCloud).toBe(s.paidPro && s.hasCloudEnt);
    });

    it('Private access diverges ONLY in the free-user-with-sample state (entitlement source)', () => {
        const privateDisagreements = matrix.filter(s => {
            const providerP = callers.provider(s).allowPrivate;
            const hookP = callers.hook(s).allowPrivate;
            const lifeP = callers.lifecycle(s).allowPrivate;
            return new Set([providerP, hookP, lifeP]).size !== 1;
        });
        // Every disagreeing state is exactly a free-user-with-sample state, and there is at least one.
        expect(privateDisagreements.every(isFreeWithSample)).toBe(true);
        expect(privateDisagreements.length).toBeGreaterThan(0);
        for (const s of privateDisagreements) {
            expect(callers.lifecycle(s).allowPrivate).toBe(true);  // capability grants
            expect(callers.provider(s).allowPrivate).toBe(false);  // tier-only deny
            expect(callers.hook(s).allowPrivate).toBe(false);
        }
    });

    it('preferredMode CAN diverge for a non-pro user with a non-native selected mode (mode normalization)', () => {
        // A free user who has selected "private": provider forces null→base, hook forces 'native',
        // lifecycle passes 'private'. This is a REAL policy difference — documented here, proven inert
        // by the record-time authority test (only the lifecycle policy governs a recording).
        const s: State = { paidPro: false, hasPrivateSample: false, hasCloudEnt: false, requestedMode: 'private' };
        expect(callers.provider(s).preferredMode).toBe('native');   // requested→null → base FREE preferredMode
        expect(callers.hook(s).preferredMode).toBe('native');       // forced native
        expect(callers.lifecycle(s).preferredMode).toBe('private'); // passes the requested mode
        // The divergence is confined to preferredMode/executionIntent/fallback; capability (private/cloud/native) matches here.
        expect(callers.lifecycle(s).allowPrivate).toBe(false);      // free, no sample → still no Private capability
    });
});
