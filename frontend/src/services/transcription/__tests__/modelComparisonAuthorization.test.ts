// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    consumeModelComparisonAuthorization, consumeModelComparisonTakeAuthorization,
    modelComparisonTakeNonce, modelComparisonEvidenceDocumentId,
    modelComparisonSessionBindingSha256,
} from '../modelComparisonAuthorization';
import { authorizeProduction, placeAuthorization, resetAuthorization } from './modelComparisonAuthorization.helper';

describe('#1432 run-issued Production model-comparison authorization (page gate: defense-in-depth only)', () => {
    afterEach(resetAuthorization);

    it('accepts one valid release/origin-bound run authorization', async () => {
        const accepted = await authorizeProduction();
        expect(accepted.accepted).toBe(true);
        expect(modelComparisonTakeNonce()).toBeNull();
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(true);
        expect(modelComparisonTakeNonce()).toBe(accepted.authorization.nonce);
        expect(modelComparisonEvidenceDocumentId()).toBe('11111111-1111-4111-8111-111111111111');
    });

    it.each([
        ['stale release', { releaseSha: 'b'.repeat(40) }],
        ['wrong origin', { origin: 'https://lookalike.example' }],
        ['issued in the future', { issuedAt: new Date(Date.now() + 10 * 60_000).toISOString() }],
        ['unparseable issue time', { issuedAt: 'yesterday' }],
        ['invalid evidence document', { evidenceDocumentId: 'operator-label' }],
    ])('refuses %s authorization', async (_label, override) => {
        expect((await authorizeProduction(override)).accepted).toBe(false);
        expect(modelComparisonTakeNonce()).toBeNull();
    });

    it('refuses replay of an already consumed nonce', async () => {
        const placed = placeAuthorization();
        expect(await consumeModelComparisonAuthorization()).toBe(true);
        Object.defineProperty(window, Symbol.for('speaksharp.model-comparison.authorization'), {
            value: placed.authorization, configurable: true,
        });
        expect(await consumeModelComparisonAuthorization()).toBe(false);
    });

    it('CASUALTY: replay stays refused after the module is replaced by a new document', async () => {
        const placed = placeAuthorization();
        expect(await consumeModelComparisonAuthorization()).toBe(true);
        vi.resetModules();
        Object.defineProperty(window, Symbol.for('speaksharp.model-comparison.authorization'), {
            value: placed.authorization, configurable: true,
        });
        const replacement = await import('../modelComparisonAuthorization');
        expect(await replacement.consumeModelComparisonAuthorization()).toBe(false);
    });

    it('CASUALTY: one authorized row permits exactly one matching switch', async () => {
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

    it('CASUALTY: candidate or journey substitution spends and refuses the authorized row', async () => {
        await authorizeProduction();
        expect(consumeModelComparisonTakeAuthorization('v2:base.en', 'open_mic')).toBe(false);
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(false);

        await authorizeProduction({ nonce: `second-${Date.now()}-nonce`, journey: 'focus_points' });
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(false);
    });

    it('CONTROL: an authorization issued long ago still arms once — there is no wall-clock expiry (PM 5651684739)', async () => {
        const placed = await authorizeProduction({ issuedAt: new Date(Date.now() - 6 * 60 * 60_000).toISOString() });
        expect(placed.accepted).toBe(true);
        expect(consumeModelComparisonTakeAuthorization('v4:distil:q4', 'open_mic')).toBe(true);
    });

    it('refuses a malformed authorization with no run id or schema version', async () => {
        expect((await authorizeProduction({ runId: undefined })).accepted).toBe(false);
        expect((await authorizeProduction({ schemaVersion: 'speaksharp.model-comparison-authorization.v1' })).accepted).toBe(false);
        expect(modelComparisonTakeNonce()).toBeNull();
    });

    it('CASUALTY: the public arming function ignores caller-supplied document state', async () => {
        const placed = placeAuthorization();
        const symbol = Symbol.for('speaksharp.model-comparison.authorization');
        delete (window as unknown as Record<symbol, unknown>)[symbol];
        const forgedRoot = {
            [symbol]: placed.authorization,
            __APP_RELEASE__: placed.authorization.releaseSha,
            location: { origin: placed.authorization.origin },
            localStorage: window.localStorage,
        };
        const publicVerifier = consumeModelComparisonAuthorization as unknown as (
            root: typeof globalThis, now: number,
        ) => Promise<boolean>;

        // A page can import this public function, but JavaScript's extra arguments must not become alternate
        // document state. The real document has no authorization injected, so it must HOLD.
        expect(await publicVerifier(
            forgedRoot as unknown as typeof globalThis,
            Date.now(),
        )).toBe(false);
    });
});
