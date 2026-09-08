// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { consumeModelComparisonAuthorization, modelComparisonControlNonce } from '../modelComparisonAuthorization';
import { authorizeProduction, placeSignedAuthorization, resetAuthorization } from './modelComparisonAuthorization.helper';

describe('#1432 signed Production model-comparison authorization', () => {
    afterEach(resetAuthorization);

    it('accepts one valid release/origin-bound Ed25519 envelope', async () => {
        const accepted = await authorizeProduction();
        expect(accepted.accepted).toBe(true);
        expect(modelComparisonControlNonce()).toBe(accepted.authorization.payload.nonce);
    });

    it.each([
        ['stale release', { releaseSha: 'b'.repeat(40) }],
        ['wrong origin', { origin: 'https://lookalike.example' }],
        ['expired', { issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:01:00.000Z' }],
    ])('refuses %s authorization', async (_label, override) => {
        expect((await authorizeProduction(override)).accepted).toBe(false);
        expect(modelComparisonControlNonce()).toBeNull();
    });

    it('refuses replay of an already consumed nonce', async () => {
        const placed = placeSignedAuthorization();
        expect(await consumeModelComparisonAuthorization(placed.env, window)).toBe(true);
        Object.defineProperty(window, Symbol.for('speaksharp.model-comparison.authorization'), {
            value: placed.authorization, configurable: true,
        });
        expect(await consumeModelComparisonAuthorization(placed.env, window)).toBe(false);
    });

    it('refuses a page-authored envelope with an arbitrary signature', async () => {
        const placed = placeSignedAuthorization();
        Object.defineProperty(window, Symbol.for('speaksharp.model-comparison.authorization'), {
            value: { ...placed.authorization, signature: Buffer.alloc(64, 7).toString('base64') }, configurable: true,
        });
        expect(await consumeModelComparisonAuthorization(placed.env, window)).toBe(false);
    });
});
