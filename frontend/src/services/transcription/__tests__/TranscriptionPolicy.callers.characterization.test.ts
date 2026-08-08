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
 * #1184 UPDATE (STT exclusivity): `buildPolicyForUser` is now Private-only for ALL inputs, so the former
 * caller divergences — (a) Private access for a free-user-with-sample, and (b) preferredMode for a non-pro
 * user with a non-native selected mode — are RETIRED. Every caller converges on an identical Private-only
 * policy. The (paidPro × sample × cloudEnt × requestedMode) matrix below is retained to PROVE that
 * convergence: no caller, under any input, can produce a native/cloud-capable policy.
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

describe('#1036 → #1184: buildPolicyForUser callers all CONVERGE on Private-only', () => {
    it('base policies are both Private-only (fixture guard)', () => {
        expect(PROD_FREE_POLICY.allowPrivate).toBe(true);
        expect(PROD_FREE_POLICY.allowNative).toBe(false);
        expect(PROD_FREE_POLICY.allowCloud).toBe(false);
        expect(PROD_PRO_POLICY.allowPrivate).toBe(true);
        expect(PROD_PRO_POLICY.allowNative).toBe(false);
        expect(PROD_PRO_POLICY.allowCloud).toBe(false);
    });

    it('#1184: every caller, across the full (paidPro × sample × cloudEnt × requestedMode) matrix, yields an identical Private-only policy', () => {
        for (const s of matrix) {
            for (const caller of [callers.provider, callers.hook, callers.lifecycle]) {
                const p = caller(s);
                expect(p.allowNative).toBe(false);
                expect(p.allowCloud).toBe(false);
                expect(p.allowPrivate).toBe(true);
                expect(p.preferredMode).toBe('private');
            }
        }
    });

    it('#1184: the former tier/entitlement/mode divergences are GONE — every capability agrees across callers', () => {
        for (const s of matrix) {
            const p = callers.provider(s), h = callers.hook(s), l = callers.lifecycle(s);
            expect(new Set([p.allowNative, h.allowNative, l.allowNative]).size).toBe(1);
            expect(new Set([p.allowCloud, h.allowCloud, l.allowCloud]).size).toBe(1);
            expect(new Set([p.allowPrivate, h.allowPrivate, l.allowPrivate]).size).toBe(1);
            expect(new Set([p.preferredMode, h.preferredMode, l.preferredMode]).size).toBe(1);
        }
    });
});
