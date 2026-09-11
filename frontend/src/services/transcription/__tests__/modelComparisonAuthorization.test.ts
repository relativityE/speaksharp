// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    consumeModelComparisonAuthorization, consumeModelComparisonTakeAuthorization,
    modelComparisonControlNonce, modelComparisonEvidenceDocumentId,
    modelComparisonSessionBindingSha256,
} from '../modelComparisonAuthorization';
import { authorizeProduction, placeSignedAuthorization, resetAuthorization } from './modelComparisonAuthorization.helper';

describe('#1432 signed Production model-comparison authorization', () => {
    afterEach(resetAuthorization);

    it('accepts one valid release/origin-bound Ed25519 envelope', async () => {
        const accepted = await authorizeProduction();
        expect(accepted.accepted).toBe(true);
        expect(modelComparisonControlNonce()).toBeNull();
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(true);
        expect(modelComparisonControlNonce()).toBe(accepted.authorization.payload.nonce);
        expect(modelComparisonEvidenceDocumentId()).toBe('11111111-1111-4111-8111-111111111111');
    });

    it.each([
        ['stale release', { releaseSha: 'b'.repeat(40) }],
        ['wrong origin', { origin: 'https://lookalike.example' }],
        ['expired', { issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:01:00.000Z' }],
        ['invalid evidence document', { evidenceDocumentId: 'operator-label' }],
    ])('refuses %s authorization', async (_label, override) => {
        expect((await authorizeProduction(override)).accepted).toBe(false);
        expect(modelComparisonControlNonce()).toBeNull();
    });

    it('refuses replay of an already consumed nonce', async () => {
        const placed = placeSignedAuthorization();
        expect(await consumeModelComparisonAuthorization()).toBe(true);
        Object.defineProperty(window, Symbol.for('speaksharp.model-comparison.authorization'), {
            value: placed.authorization, configurable: true,
        });
        expect(await consumeModelComparisonAuthorization()).toBe(false);
    });

    it('CASUALTY: replay stays refused after the module is replaced by a new document', async () => {
        const placed = placeSignedAuthorization();
        expect(await consumeModelComparisonAuthorization()).toBe(true);
        vi.resetModules();
        Object.defineProperty(window, Symbol.for('speaksharp.model-comparison.authorization'), {
            value: placed.authorization, configurable: true,
        });
        const replacement = await import('../modelComparisonAuthorization');
        expect(await replacement.consumeModelComparisonAuthorization()).toBe(false);
    });

    it('CASUALTY: one signed row authorizes exactly one matching switch', async () => {
        await authorizeProduction();
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(true);
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(false);
    });

    it('pins byte-exact browser session binding and refuses non-UUID session ids', async () => {
        await authorizeProduction({
            nonce: 'binding-vector-123456',
            evidenceDocumentId: '11111111-1111-4111-8111-111111111111',
        });
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(true);
        await expect(modelComparisonSessionBindingSha256('22222222-2222-4222-8222-222222222222'))
            .resolves.toBe('79fb824b7746e990fce8913b12e004b18ea1f706ff69722a3da91fb25289e478');
        await expect(modelComparisonSessionBindingSha256('session-1')).resolves.toBeNull();
    });

    it('CASUALTY: candidate or journey substitution spends and refuses the signed row', async () => {
        await authorizeProduction();
        expect(consumeModelComparisonTakeAuthorization('v2:base.en', 'open_mic')).toBe(false);
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(false);

        await authorizeProduction({ nonce: `second-${Date.now()}-nonce`, journey: 'focus_points' });
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(false);
    });

    it('refuses a page-authored envelope with an arbitrary signature', async () => {
        const placed = placeSignedAuthorization();
        Object.defineProperty(window, Symbol.for('speaksharp.model-comparison.authorization'), {
            value: { ...placed.authorization, signature: Buffer.alloc(64, 7).toString('base64') }, configurable: true,
        });
        expect(await consumeModelComparisonAuthorization()).toBe(false);
    });

    it('CASUALTY: the public verifier ignores caller-supplied trust roots', async () => {
        const placed = placeSignedAuthorization();
        const symbol = Symbol.for('speaksharp.model-comparison.authorization');
        delete (window as unknown as Record<symbol, unknown>)[symbol];
        const forgedRoot = {
            [symbol]: placed.authorization,
            __APP_RELEASE__: placed.authorization.payload.releaseSha,
            location: { origin: placed.authorization.payload.origin },
            crypto: window.crypto,
            localStorage: window.localStorage,
        };
        const publicVerifier = consumeModelComparisonAuthorization as unknown as (
            env: Record<string, unknown>, root: typeof globalThis, now: number,
        ) => Promise<boolean>;

        // A page can import this public function, but JavaScript's extra arguments must not become
        // alternate build/platform authority. The real document has no envelope, so it must HOLD.
        expect(await publicVerifier(
            placed.env,
            forgedRoot as unknown as typeof globalThis,
            Date.now(),
        )).toBe(false);
    });
});
