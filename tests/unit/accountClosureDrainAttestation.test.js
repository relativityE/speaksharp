// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { accountClosureBindingDigest, validateAccountClosureDrainAttestation } from '../../scripts/lib/accountClosureDrainAttestation.mjs';

const hash = (letter, length = 64) => letter.repeat(length);
function fixture() {
    const deployments = ['stripe-checkout', 'account-closure'].map((name) => ({ function: name, region: 'us-east-1', deploymentId: name,
        version: 'v2', sha: hash('a', 40) }));
    const legacyScopes = [{ scopeId: 'checkout-v1-us-east-1', deploymentId: 'checkout-v1', region: 'us-east-1', sha: hash('b', 40) }];
    const context = { candidateSha: hash('a', 40), mainSha: hash('c', 40), migrationDigest: hash('d'), configDigest: hash('e'),
        evidenceDigest: hash('f'), target: { projectId: 'project-test', environment: 'disposable' }, deployments, legacyScopes,
        now: '2026-10-14T20:00:01.000Z' };
    const record = { version: 1, candidateSha: context.candidateSha, mainSha: context.mainSha, migrationDigest: context.migrationDigest,
        target: context.target, deployments, configDigest: context.configDigest, bindingDigest: accountClosureBindingDigest(context),
        payments: { frontendEnabled: false, backendEnabled: false, evidenceDigest: hash('1') }, operatorId: 'operator-test',
        createdAt: '2026-10-14T20:00:00.000Z', expiresAt: '2026-10-14T20:10:00.000Z', evidenceDigest: context.evidenceDigest,
        legacyWriters: [{ ...legacyScopes[0], executionLimitMs: 400000, backgroundLimitMs: 400000,
            lastPossibleStartAt: '2026-10-14T19:50:00.000Z', observedThrough: '2026-10-14T19:59:00.000Z',
            terminationVerified: true, terminationEvidenceDigest: hash('2'), lifetimeEvidenceDigest: hash('3') }],
        inventory: { completedAt: '2026-10-14T19:59:00.000Z', pages: [{ cursor: null, nextCursor: 'cursor-2', evidenceDigest: hash('4') },
            { cursor: 'cursor-2', nextCursor: null, evidenceDigest: hash('5') }], operations: [{
            operationId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222',
            phase: 'unknown', disposition: 'quarantined', evidenceDigest: hash('6') }] } };
    return { context: structuredClone(context), record: structuredClone(record) };
}

describe('versioned account closure drain attestation — offline only', () => {
    it('binds reviewed facts and keeps unknown operations quarantined without activation', () => {
        const { record, context } = fixture();
        const result = validateAccountClosureDrainAttestation(record, context);
        expect(result.activationAuthorized).toBe(false);
        expect(result.quarantined).toEqual([{ operationId: record.inventory.operations[0].operationId,
            userId: record.inventory.operations[0].userId, phase: 'unknown' }]);
    });
    it.each([
        ['unknown top-level key', (r) => { r.activate = true; }],
        ['unknown nested key', (r) => { r.payments.override = true; }],
        ['wrong version', (r) => { r.version = 2; }],
        ['wrong release', (r) => { r.candidateSha = hash('b', 40); }],
        ['wrong main', (r) => { r.mainSha = hash('b', 40); }],
        ['wrong migration', (r) => { r.migrationDigest = hash('b'); }],
        ['wrong target', (r) => { r.target.projectId = 'other'; }],
        ['missing deploy scope', (r) => { r.deployments.pop(); }],
        ['duplicate deploy scope', (r) => { r.deployments.push(r.deployments[0]); }],
        ['wrong deployment version', (r) => { r.deployments[0].version = 'v1'; }],
        ['wrong region', (r) => { r.deployments[0].region = 'us-west-1'; }],
        ['missing legacy writer', (r) => { r.legacyWriters = []; }],
        ['duplicate legacy writer', (r) => { r.legacyWriters.push(r.legacyWriters[0]); }],
        ['unknown legacy region', (r) => { r.legacyWriters[0].region = 'other'; }],
        ['elapsed time alone', (r) => { r.legacyWriters[0].terminationVerified = false; }],
        ['missing platform lifetime', (r) => { r.legacyWriters[0].lifetimeEvidenceDigest = null; }],
        ['HTTP idle timeout mistaken for drain', (r) => { r.legacyWriters[0].observedThrough = '2026-10-14T19:52:30.000Z'; }],
        ['background outlives observation', (r) => { r.legacyWriters[0].backgroundLimitMs = 600000; }],
        ['guessed lifetime', (r) => { r.legacyWriters[0].executionLimitMs = 0; }],
        ['partial pagination', (r) => { r.inventory.pages.pop(); }],
        ['cursor gap', (r) => { r.inventory.pages[1].cursor = 'missing'; }],
        ['cursor loop', (r) => { r.inventory.pages[1].nextCursor = 'cursor-2'; }],
        ['terminal page followed by more', (r) => { r.inventory.pages[0].nextCursor = null; }],
        ['unknown settled optimistically', (r) => { r.inventory.operations[0].disposition = 'provider_verified_settled'; }],
        ['operation duplicate', (r) => { r.inventory.operations.push(r.inventory.operations[0]); }],
        ['operation owner missing', (r) => { r.inventory.operations[0].userId = null; }],
        ['payments enabled', (r) => { r.payments.backendEnabled = true; }],
        ['no switch evidence', (r) => { r.payments.evidenceDigest = null; }],
        ['expired', (r) => { r.expiresAt = '2026-10-14T20:00:01.000Z'; }],
        ['future', (r) => { r.createdAt = '2026-10-14T20:01:00.000Z'; }],
        ['excessive validity', (r) => { r.expiresAt = '2026-10-14T20:30:00.000Z'; }],
        ['stale inventory', (r) => { r.inventory.completedAt = '2026-10-14T19:00:00.000Z'; }],
        ['tampered evidence artifact', (r) => { r.evidenceDigest = hash('b'); }],
    ])('HOLD: %s', (_label, mutate) => {
        const { record, context } = fixture(); mutate(record);
        expect(() => validateAccountClosureDrainAttestation(record, context)).toThrow('HOLD:');
    });
    it.each(['candidateSha', 'mainSha', 'configDigest'])('invalidates on current %s change', (key) => {
        const { record, context } = fixture(); context[key] = hash('b', key.endsWith('Sha') ? 40 : 64);
        expect(() => validateAccountClosureDrainAttestation(record, context)).toThrow('HOLD:');
    });
    it('rejects a new current legacy-writer scope rather than silently ignoring it', () => {
        const { record, context } = fixture(); context.legacyScopes.push({ ...context.legacyScopes[0], scopeId: 'new-writer' });
        expect(() => validateAccountClosureDrainAttestation(record, context)).toThrow('HOLD:');
    });
    it('accepts provider-verified settled and quarantined issuing/open states without resetting anything', () => {
        for (const phase of ['issuing', 'open', 'settled']) {
            const { record, context } = fixture(); record.inventory.operations[0].phase = phase;
            if (phase === 'settled') record.inventory.operations[0].disposition = 'provider_verified_settled';
            expect(validateAccountClosureDrainAttestation(record, context).quarantined.length).toBe(phase === 'settled' ? 0 : 1);
        }
    });
});
