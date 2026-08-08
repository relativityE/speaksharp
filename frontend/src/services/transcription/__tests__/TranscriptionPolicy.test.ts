import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    resolveMode,
    isModeAllowed,
    buildPolicyForUser,
    PROD_FREE_POLICY,
    PROD_PRO_POLICY,
    E2E_DETERMINISTIC_NATIVE,
    E2E_DETERMINISTIC_CLOUD,
    E2E_DETERMINISTIC_PRIVATE,
    TranscriptionPolicy,
    TranscriptionMode
} from '../TranscriptionPolicy';

describe('TranscriptionPolicy', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('isModeAllowed', () => {
        const policy: TranscriptionPolicy = {
            allowNative: true,
            allowCloud: false,
            allowPrivate: true,
            preferredMode: 'native',
            allowFallback: false
        };

        it('should correctly identify allowed modes', () => {
            expect(isModeAllowed('native', policy)).toBe(true);
            expect(isModeAllowed('private', policy)).toBe(true);
        });

        it('should correctly identify disallowed modes', () => {
            expect(isModeAllowed('cloud', policy)).toBe(false);
        });

        it('should return false for unknown modes (type safety)', () => {
            expect(isModeAllowed('unknown' as unknown as TranscriptionMode, policy)).toBe(false);
        });
    });

    describe('resolveMode', () => {
        it('should prioritize allowed user preference', () => {
            const policy: TranscriptionPolicy = {
                allowNative: true,
                allowCloud: true,
                allowPrivate: true,
                preferredMode: 'cloud',
                allowFallback: true
            };
            expect(resolveMode(policy, 'private')).toBe('private');
        });

        it('should ignore disallowed user preference', () => {
            const policy: TranscriptionPolicy = {
                allowNative: true,
                allowCloud: false,
                allowPrivate: true,
                preferredMode: 'native',
                allowFallback: true
            };
            // Preference is cloud, but not allowed, so fallback to preferredMode 'native'
            expect(resolveMode(policy, 'cloud')).toBe('native');
        });

        it('should use policy preferredMode if no user preference', () => {
            const policy: TranscriptionPolicy = {
                allowNative: true,
                allowCloud: true,
                allowPrivate: false,
                preferredMode: 'cloud',
                allowFallback: true
            };
            expect(resolveMode(policy, null)).toBe('cloud');
        });

        it('should fallback to allowed modes in order: native -> cloud -> private', () => {
            const nativePolicy: TranscriptionPolicy = {
                allowNative: true,
                allowCloud: true,
                allowPrivate: true,
                preferredMode: null,
                allowFallback: true
            };
            expect(resolveMode(nativePolicy)).toBe('native');

            const cloudPolicy: TranscriptionPolicy = {
                allowNative: false,
                allowCloud: true,
                allowPrivate: true,
                preferredMode: null,
                allowFallback: true
            };
            expect(resolveMode(cloudPolicy)).toBe('cloud');

            const privatePolicy: TranscriptionPolicy = {
                allowNative: false,
                allowCloud: false,
                allowPrivate: true,
                preferredMode: null,
                allowFallback: true
            };
            expect(resolveMode(privatePolicy)).toBe('private');
        });

        it('should throw error if no modes are allowed', () => {
            const emptyPolicy: TranscriptionPolicy = {
                allowNative: false,
                allowCloud: false,
                allowPrivate: false,
                preferredMode: null,
                allowFallback: false
            };
            expect(() => resolveMode(emptyPolicy)).toThrow(/No allowed transcription mode/);
        });
    });

    describe('buildPolicyForUser', () => {
        it('should build free tier policy correctly', () => {
            const policy = buildPolicyForUser(false);
            expect(policy.allowNative).toBe(PROD_FREE_POLICY.allowNative);
            expect(policy.allowCloud).toBe(PROD_FREE_POLICY.allowCloud);
            expect(policy.allowPrivate).toBe(PROD_FREE_POLICY.allowPrivate);
            expect(policy.executionIntent).toContain('prod-free');
        });

        it('should build pro tier policy correctly', () => {
            const policy = buildPolicyForUser(true);
            expect(policy.allowNative).toBe(PROD_PRO_POLICY.allowNative);
            expect(policy.allowCloud).toBe(PROD_PRO_POLICY.allowCloud);
            expect(policy.allowPrivate).toBe(PROD_PRO_POLICY.allowPrivate);
            expect(policy.allowFallback).toBe(false);
            expect(policy.executionIntent).toContain('prod-pro');
        });

        it('should apply UI mode override', () => {
            const policy = buildPolicyForUser(true, 'private');
            expect(policy.preferredMode).toBe('private');
            expect(policy.allowFallback).toBe(false);
            expect(policy.executionIntent).toContain('private');
        });

        it('keeps alternative STT choices manual instead of enabling automatic fallback', () => {
            expect(buildPolicyForUser(true).allowFallback).toBe(false);
            expect(buildPolicyForUser(true, 'private').allowFallback).toBe(false);
            expect(buildPolicyForUser(true, 'native').allowFallback).toBe(false);
            expect(buildPolicyForUser(true, 'cloud', { allowCloud: true }).allowFallback).toBe(false);
        });

        it('#1184: is Private-only even when cloud is requested with allowCloud:true', () => {
            // Under STT exclusivity, neither uiMode='cloud' nor allowCloud:true can widen the engine set.
            const policy = buildPolicyForUser(true, 'cloud', { allowCloud: true });
            expect(policy.allowNative).toBe(false);
            expect(policy.allowPrivate).toBe(true);
            expect(policy.allowCloud).toBe(false);
            expect(policy.preferredMode).toBe('private');
            expect(policy.allowFallback).toBe(false);
            expect(policy.executionIntent).toContain('private');
        });
    });

    // #1184 STT exclusivity RETIRES the former "policy-writer divergence": engine no longer varies by
    // tier or by which writer builds the policy — EVERY buildPolicyForUser call is Private-only. This
    // guard locks that: a future re-introduction of tier/engine branching would fail here.
    describe('#1184: no tier/writer engine divergence — every policy is Private-only', () => {
        it('free (tier-only isPro=false) yields Private-only, not native', () => {
            const p = buildPolicyForUser(false, null, { allowCloud: false });
            expect(p.allowPrivate).toBe(true);
            expect(p.allowNative).toBe(false);
            expect(p.allowCloud).toBe(false);
            expect(p.preferredMode).toBe('private');
        });

        it('capability-based (true) and tier-only (false) now AGREE — Private-only both ways', () => {
            const cap = buildPolicyForUser(true, 'private', { allowCloud: false });
            const tier = buildPolicyForUser(false, 'private', { allowCloud: false });
            expect(cap.allowPrivate).toBe(true);
            expect(tier.allowPrivate).toBe(true);
            expect(cap.allowNative).toBe(false);
            expect(tier.allowNative).toBe(false);
            expect(cap.allowCloud).toBe(false);
            expect(tier.allowCloud).toBe(false);
        });
    });

    describe('Pre-built Policies', () => {
        it('#1184: PROD_FREE_POLICY is Private-only', () => {
            expect(PROD_FREE_POLICY.allowNative).toBe(false);
            expect(PROD_FREE_POLICY.allowCloud).toBe(false);
            expect(PROD_FREE_POLICY.allowPrivate).toBe(true);
            expect(PROD_FREE_POLICY.preferredMode).toBe('private');
        });

        it('#1184: PROD_PRO_POLICY is Private-only (same engine posture as Free)', () => {
            expect(PROD_PRO_POLICY.allowNative).toBe(false);
            expect(PROD_PRO_POLICY.allowCloud).toBe(false);
            expect(PROD_PRO_POLICY.allowPrivate).toBe(true);
            expect(PROD_PRO_POLICY.allowFallback).toBe(false);
        });

        // The deterministic native/cloud E2E policies still EXIST as code (native/cloud engine removal is
        // the later, orderly layer-2 cleanup per #1165/#1184); they are simply no longer reachable through
        // the user-facing resolution path.
        it('E2E policies should be deterministic', () => {
            expect(E2E_DETERMINISTIC_NATIVE.preferredMode).toBe('native');
            expect(E2E_DETERMINISTIC_CLOUD.preferredMode).toBe('cloud');
            expect(E2E_DETERMINISTIC_PRIVATE.preferredMode).toBe('private');
        });
    });

    // #1184 FAIL-CLOSED GUARD: no matter what a caller requests (tier, uiMode, allowCloud), the
    // user-facing resolution can ONLY ever be Private. This is the integrity backstop the STT-core
    // cutover exists to enforce — it must fail if anyone reintroduces native/cloud resolution.
    describe('#1184 fail-closed: user-facing resolution can never be native/cloud', () => {
        it.each(['native', 'cloud', 'private', null] as (TranscriptionMode | null)[])(
            'resolveMode(PROD_FREE_POLICY, %s) === private', (pref) => {
                expect(resolveMode(PROD_FREE_POLICY, pref)).toBe('private');
            });

        it.each(['native', 'cloud', 'private', null] as (TranscriptionMode | null)[])(
            'resolveMode(PROD_PRO_POLICY, %s) === private', (pref) => {
                expect(resolveMode(PROD_PRO_POLICY, pref)).toBe('private');
            });

        it('buildPolicyForUser never yields a native/cloud-capable policy, for any inputs', () => {
            for (const isPro of [false, true]) {
                for (const uiMode of ['native', 'cloud', 'private', null] as (TranscriptionMode | null)[]) {
                    for (const allowCloud of [false, true]) {
                        const p = buildPolicyForUser(isPro, uiMode, { allowCloud });
                        expect(p.allowNative).toBe(false);
                        expect(p.allowCloud).toBe(false);
                        expect(p.allowPrivate).toBe(true);
                        expect(resolveMode(p, uiMode)).toBe('private');
                    }
                }
            }
        });
    });
});
