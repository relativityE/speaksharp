import { describe, expect, it } from 'vitest';
import { buildPolicyForUser, PROD_FREE_POLICY, PROD_PRO_POLICY, type TranscriptionMode } from '../TranscriptionPolicy';

describe('buildPolicyForUser production convergence', () => {
    it('keeps both compatibility labels Private-only', () => {
        for (const policy of [PROD_FREE_POLICY, PROD_PRO_POLICY]) {
            expect(policy).toMatchObject({
                allowNative: false,
                allowPrivate: true,
                preferredMode: 'private',
            });
        }
    });

    it('cannot widen the customer engine set for any commercial label or stale request', () => {
        const requested: Array<TranscriptionMode | null> = [null, 'native', 'private'];
        for (const paid of [false, true]) {
            for (const mode of requested) {
                const policy = buildPolicyForUser(paid, mode);
                expect(policy.allowNative).toBe(false);
                expect(policy.allowPrivate).toBe(true);
                expect(policy.preferredMode).toBe('private');
            }
        }
    });
});
