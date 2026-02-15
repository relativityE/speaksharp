import { describe, it, expect } from 'vitest';
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
            expect(policy.executionIntent).toContain('prod-pro');
        });

        it('should apply UI mode override', () => {
            const policy = buildPolicyForUser(true, 'private');
            expect(policy.preferredMode).toBe('private');
            expect(policy.executionIntent).toContain('private');
        });
    });

    describe('Pre-built Policies', () => {
        it('PROD_FREE_POLICY should only allow native', () => {
            expect(PROD_FREE_POLICY.allowNative).toBe(true);
            expect(PROD_FREE_POLICY.allowCloud).toBe(false);
            expect(PROD_FREE_POLICY.allowPrivate).toBe(false);
        });

        it('PROD_PRO_POLICY should allow all', () => {
            expect(PROD_PRO_POLICY.allowNative).toBe(true);
            expect(PROD_PRO_POLICY.allowCloud).toBe(true);
            expect(PROD_PRO_POLICY.allowPrivate).toBe(true);
        });

        it('E2E policies should be deterministic', () => {
            expect(E2E_DETERMINISTIC_NATIVE.preferredMode).toBe('native');
            expect(E2E_DETERMINISTIC_CLOUD.preferredMode).toBe('cloud');
            expect(E2E_DETERMINISTIC_PRIVATE.preferredMode).toBe('private');
        });
    });
});
