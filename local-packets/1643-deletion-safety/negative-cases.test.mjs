// Local evidence for the existing guard, not an implementation of the proposed capability design.
// Run: node --test local-packets/1643-deletion-safety/negative-cases.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { accountClosureBindingDigest, validateAccountClosureDrainAttestation } from '../../scripts/lib/accountClosureDrainAttestation.mjs';
import { createAccountClosureAttestationService } from '../../scripts/lib/accountClosureAttestationService.mjs';

const hash = (c, n = 64) => c.repeat(n);
const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
    const deployments = ['stripe-checkout', 'account-closure'].map((name) => ({ function: name, region: 'us-east-1',
        deploymentId: name, version: 'v2', sha: hash('a', 40) }));
    const legacyScopes = [{ scopeId: 'legacy-checkout', deploymentId: 'legacy-v1', region: 'us-east-1', sha: hash('b', 40) }];
    const context = { candidateSha: hash('a', 40), mainSha: hash('c', 40), migrationDigest: hash('d'),
        configDigest: hash('e'), evidenceDigest: hash('f'), target: { projectId: 'mock-only', environment: 'disposable' },
        deployments, legacyScopes, now: '2026-10-14T20:00:01.000Z' };
    const record = { version: 1, candidateSha: context.candidateSha, mainSha: context.mainSha,
        migrationDigest: context.migrationDigest, target: context.target, deployments,
        configDigest: context.configDigest, evidenceDigest: context.evidenceDigest,
        bindingDigest: accountClosureBindingDigest(context), operatorId: 'mock-operator',
        payments: { frontendEnabled: false, backendEnabled: false, evidenceDigest: hash('1') },
        createdAt: '2026-10-14T20:00:00.000Z', expiresAt: '2026-10-14T20:10:00.000Z',
        legacyWriters: [{ ...legacyScopes[0], executionLimitMs: 400000, backgroundLimitMs: 400000,
            lastPossibleStartAt: '2026-10-14T19:50:00.000Z', observedThrough: '2026-10-14T19:59:00.000Z',
            terminationVerified: true, terminationEvidenceDigest: hash('2'), lifetimeEvidenceDigest: hash('3') }],
        inventory: { completedAt: '2026-10-14T19:59:00.000Z',
            pages: [{ cursor: null, nextCursor: null, evidenceDigest: hash('4') }],
            operations: [{ operationId: id, userId: '22222222-2222-4222-8222-222222222222',
                phase: 'unknown', disposition: 'quarantined', evidenceDigest: hash('5') }] } };
    return structuredClone({ context, record });
}

test('control: offline-valid keeps accepted/unknown work quarantined and never grants activation', () => {
    const { record, context } = fixture();
    const result = validateAccountClosureDrainAttestation(record, context);
    assert.equal(result.validation, 'OFFLINE_VALID');
    assert.equal(result.activationAuthorized, false);
    assert.equal(result.quarantined[0].phase, 'unknown');
});

for (const [name, mutate, reason] of [
    ['quiet/elapsed without verified termination', (r) => { r.legacyWriters[0].terminationVerified = false; }, /termination\/lifetime/],
    ['guessed maximum lifetime', (r) => { r.legacyWriters[0].executionLimitMs = 0; }, /effective lifetime/],
    ['background work outlives observation', (r) => { r.legacyWriters[0].backgroundLimitMs = 600000; }, /lifetime coverage/],
    ['scope omitted', (r) => { r.legacyWriters = []; }, /scope coverage/],
    ['provider pagination incomplete', (r) => { r.inventory.pages[0].nextCursor = 'unread'; }, /not exhausted/],
    ['accepted unknown optimistically settled', (r) => { r.inventory.operations[0].disposition = 'provider_verified_settled'; }, /cannot be settled/],
    ['DB settled without provider disposition', (r) => { r.inventory.operations[0].phase = 'settled'; }, /lacks provider disposition/],
    ['payment switch uncertain or enabled', (r) => { r.payments.backendEnabled = true; }, /not evidenced OFF/],
]) test(`HOLD: ${name}`, () => {
    const { record, context } = fixture();
    mutate(record);
    assert.throws(() => validateAccountClosureDrainAttestation(record, context), reason);
});

test('HOLD: a newly discovered legacy scope is not silently excluded', () => {
    const { record, context } = fixture();
    context.legacyScopes.push({ ...context.legacyScopes[0], scopeId: 'portal-or-operator-scope' });
    // Rebind to distinguish coverage refusal from a simple stale digest.
    record.bindingDigest = accountClosureBindingDigest(context);
    assert.throws(() => validateAccountClosureDrainAttestation(record, context), /scope coverage/);
});

test('HOLD: missing independent authority makes zero registration calls', async () => {
    let writes = 0;
    const service = createAccountClosureAttestationService({
        getCurrentContext: async () => { throw new Error('unavailable mock authority'); },
        rpc: async () => { writes++; throw new Error('must never write'); },
    });
    const result = await service.register({ attestationId: id, expectedGeneration: '7', schemaEvidence: {}, attestation: {} });
    assert.equal(result.status, 'HOLD');
    assert.equal(result.reason, 'CONTEXT_UNAVAILABLE');
    assert.equal(result.activationAuthorized, false);
    assert.equal(writes, 0);
});

test('characterization: matching caller-supplied JSON cannot prove a complete external inventory', () => {
    const { record, context } = fixture();
    // This is deliberately fabricated evidence, used ONLY to expose the validator's trust boundary.
    // Omitting an accepted request from both views cannot be detected by a structural validator.
    record.inventory.operations = [];
    const result = validateAccountClosureDrainAttestation(record, context);
    assert.equal(result.validation, 'OFFLINE_VALID');
    assert.equal(result.activationAuthorized, false);
    assert.deepEqual(result.quarantined, []);
});
