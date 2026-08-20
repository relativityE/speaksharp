import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    resolveMode,
    isModeAllowed,
    buildPolicyForUser,
    PROD_FREE_POLICY,
    PROD_PRO_POLICY,
    E2E_DETERMINISTIC_NATIVE,
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
            allowPrivate: true,
            preferredMode: 'native',
            allowFallback: false
        };

        it('should correctly identify allowed modes', () => {
            expect(isModeAllowed('native', policy)).toBe(true);
            expect(isModeAllowed('private', policy)).toBe(true);
        });


        it('should return false for unknown modes (type safety)', () => {
            expect(isModeAllowed('unknown' as unknown as TranscriptionMode, policy)).toBe(false);
        });
    });

    describe('resolveMode', () => {
        it('should prioritize allowed user preference', () => {
            const policy: TranscriptionPolicy = {
                allowNative: true,
                allowPrivate: true,
                preferredMode: 'native',
                allowFallback: true
            };
            expect(resolveMode(policy, 'private')).toBe('private');
        });

        it('should ignore disallowed user preference', () => {
            const policy: TranscriptionPolicy = {
                allowNative: false,
                allowPrivate: true,
                preferredMode: 'private',
                allowFallback: true
            };
            // Preference is native, but not allowed, so fallback to preferredMode 'private'
            expect(resolveMode(policy, 'native')).toBe('private');
        });

        it('should use policy preferredMode if no user preference', () => {
            const policy: TranscriptionPolicy = {
                allowNative: true,
                allowPrivate: false,
                preferredMode: 'native',
                allowFallback: true
            };
            expect(resolveMode(policy, null)).toBe('native');
        });


        it('should throw error if no modes are allowed', () => {
            const emptyPolicy: TranscriptionPolicy = {
                allowNative: false,
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
            expect(policy.allowPrivate).toBe(PROD_FREE_POLICY.allowPrivate);
            expect(policy.executionIntent).toContain('prod-free');
        });

        it('should build pro tier policy correctly', () => {
            const policy = buildPolicyForUser(true);
            expect(policy.allowNative).toBe(PROD_PRO_POLICY.allowNative);
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
        });

    });

    // #1184 STT exclusivity RETIRES the former "policy-writer divergence": engine no longer varies by
    // tier or by which writer builds the policy — EVERY buildPolicyForUser call is Private-only. This
    // guard locks that: a future re-introduction of tier/engine branching would fail here.
    describe('#1184: no tier/writer engine divergence — every policy is Private-only', () => {
        it('free (tier-only isPro=false) yields Private-only, not native', () => {
            const p = buildPolicyForUser(false, null);
            expect(p.allowPrivate).toBe(true);
            expect(p.allowNative).toBe(false);
            expect(p.preferredMode).toBe('private');
        });

        it('capability-based (true) and tier-only (false) now AGREE — Private-only both ways', () => {
            const cap = buildPolicyForUser(true, 'private');
            const tier = buildPolicyForUser(false, 'private');
            expect(cap.allowPrivate).toBe(true);
            expect(tier.allowPrivate).toBe(true);
            expect(cap.allowNative).toBe(false);
            expect(tier.allowNative).toBe(false);
        });
    });

    describe('Pre-built Policies', () => {
        it('#1184: PROD_FREE_POLICY is Private-only', () => {
            expect(PROD_FREE_POLICY.allowNative).toBe(false);
            expect(PROD_FREE_POLICY.allowPrivate).toBe(true);
            expect(PROD_FREE_POLICY.preferredMode).toBe('private');
        });

        it('#1184: PROD_PRO_POLICY is Private-only (same engine posture as Free)', () => {
            expect(PROD_PRO_POLICY.allowNative).toBe(false);
            expect(PROD_PRO_POLICY.allowPrivate).toBe(true);
            expect(PROD_PRO_POLICY.allowFallback).toBe(false);
        });

        // The deterministic native E2E policy still EXISTS as code (native engine removal is a later slice);
        // it is simply no longer reachable through the user-facing resolution path.
        it('E2E policies should be deterministic', () => {
            expect(E2E_DETERMINISTIC_NATIVE.preferredMode).toBe('native');
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

    });
});
