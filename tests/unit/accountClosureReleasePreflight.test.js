// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 as ACCOUNT_CLOSURE_SHA256 } from '../../scripts/lib/accountClosureEnforcementIdentity.mjs';
import { enforcedClosureReceipt } from '../helpers/accountClosureEnforcementReceipt.mjs';
import { accountClosureBindingDigest, validateAccountClosureDrainAttestation } from '../../scripts/lib/accountClosureDrainAttestation.mjs';
import { validateAccountClosureReleasePreflight } from '../../scripts/lib/accountClosureReleasePreflight.mjs';

const hash = (letter, length = 64) => letter.repeat(length);
// Same synthetic drain fixture contract as the accepted validator tests; the
// migration identity is the pinned closure source, not an arbitrary matching hash.
function fixture() {
    const deployments = ['stripe-checkout', 'account-closure'].map((name) => ({ function: name, region: 'us-east-1',
        deploymentId: name, version: 'v2', sha: hash('a', 40) }));
    const legacyScopes = [{ scopeId: 'checkout-v1-us-east-1', deploymentId: 'checkout-v1', region: 'us-east-1', sha: hash('b', 40) }];
    const context = { candidateSha: hash('a', 40), mainSha: hash('c', 40), migrationDigest: ACCOUNT_CLOSURE_SHA256,
        configDigest: hash('e'), evidenceDigest: hash('f'), target: { projectId: 'project-test', environment: 'disposable' },
        deployments, legacyScopes, now: '2026-10-14T20:00:01.000Z' };
    const attestation = { version: 1, candidateSha: context.candidateSha, mainSha: context.mainSha,
        migrationDigest: context.migrationDigest, target: context.target, deployments, configDigest: context.configDigest,
        bindingDigest: accountClosureBindingDigest(context), evidenceDigest: context.evidenceDigest,
        payments: { frontendEnabled: false, backendEnabled: false, evidenceDigest: hash('1') }, operatorId: 'operator-test',
        createdAt: '2026-10-14T20:00:00.000Z', expiresAt: '2026-10-14T20:10:00.000Z',
        legacyWriters: [{ ...legacyScopes[0], executionLimitMs: 400000, backgroundLimitMs: 400000,
            lastPossibleStartAt: '2026-10-14T19:50:00.000Z', observedThrough: '2026-10-14T19:59:00.000Z',
            terminationVerified: true, terminationEvidenceDigest: hash('2'), lifetimeEvidenceDigest: hash('3') }],
        inventory: { completedAt: '2026-10-14T19:59:00.000Z',
            pages: [{ cursor: null, nextCursor: 'cursor-2', evidenceDigest: hash('4') },
                { cursor: 'cursor-2', nextCursor: null, evidenceDigest: hash('5') }],
            operations: [{ operationId: '11111111-1111-4111-8111-111111111111',
                userId: '22222222-2222-4222-8222-222222222222', phase: 'unknown', disposition: 'quarantined', evidenceDigest: hash('6') }] },
    };
    const schema = { candidateSha: context.candidateSha, mainSha: context.mainSha, migrationDigest: ACCOUNT_CLOSURE_SHA256,
        target: context.target, receipt: enforcedClosureReceipt() };
    return { schema: structuredClone(schema), attestation: structuredClone(attestation), context: structuredClone(context) };
}
const validate = ({ schema, attestation, context }) => validateAccountClosureReleasePreflight(schema, attestation, context);

describe('account closure release preflight — pure offline composition', () => {
    it('preserves accepted evidence and quarantine without mutation or activation authority', () => {
        const input = fixture(); const before = structuredClone(input);
        const result = validate(input);
        expect(result).toEqual({ version: 1, validation: 'OFFLINE_VALID',
            bindingDigest: input.attestation.bindingDigest, evidenceDigest: input.context.evidenceDigest,
            quarantined: [{ operationId: input.attestation.inventory.operations[0].operationId,
                userId: input.attestation.inventory.operations[0].userId, phase: 'unknown' }], activationAuthorized: false });
        expect(input).toEqual(before);
        expect(validate(input)).toEqual(result);
    });

    it('valid drain evidence alone cannot replace missing schema verification', () => {
        const input = fixture();
        expect(validateAccountClosureDrainAttestation(input.attestation, input.context).validation).toBe('OFFLINE_VALID');
        expect(() => validate({ ...input, schema: { passed: true } })).toThrow('HOLD:');
    });

    it.each([
        ['schema absent', (i) => { i.schema = null; }],
        ['current context absent', (i) => { i.context = null; }],
        ['receipt absent', (i) => { delete i.schema.receipt; }],
        ['a success flag alone', (i) => { i.schema.receipt = { passed: true }; }],
        ['BEFORE instead of AFTER', (i) => { i.schema.receipt.mode = 'before'; }],
        ['failed terminal result', (i) => { i.schema.receipt.passed = false; }],
        ['incomplete stages', (i) => { i.schema.receipt.stages.pop(); }],
        ['extra stage', (i) => { i.schema.receipt.stages.push(i.schema.receipt.stages[2]); }],
        ['missing disabled check', (i) => { i.schema.receipt.stages[4].checks = {}; }],
        ['disabled check failed under success flags', (i) => { i.schema.receipt.stages[4].checks.rollout_disabled = false; }],
        ['rollout check failed', (i) => { i.schema.receipt.stages[1].checks.exact_table_definitions = false; }],
        ['stage reordered', (i) => { i.schema.receipt.stages.reverse(); }],
        ['schema activation override', (i) => { i.schema.activationAuthorized = true; }],
        ['unknown receipt field', (i) => { i.schema.receipt.override = true; }],
        ['unknown stage field', (i) => { i.schema.receipt.stages[0].override = true; }],
        ['candidate mismatch', (i) => { i.schema.candidateSha = hash('b', 40); }],
        ['main mismatch', (i) => { i.schema.mainSha = hash('b', 40); }],
        ['project mismatch', (i) => { i.schema.target.projectId = 'different'; }],
        ['environment mismatch', (i) => { i.schema.target.environment = 'production'; }],
        ['migration mismatch', (i) => { i.schema.migrationDigest = hash('d'); }],
        ['matching arbitrary migration hashes', (i) => { i.schema.migrationDigest = i.context.migrationDigest = i.attestation.migrationDigest = hash('d'); }],
        ['deployment version mismatch', (i) => { i.attestation.deployments[0].version = 'v1'; }],
        ['deployment region mismatch', (i) => { i.context.deployments[0].region = 'other'; }],
        ['configuration changed', (i) => { i.context.configDigest = hash('b'); }],
        ['release binding changed', (i) => { i.attestation.bindingDigest = hash('b'); }],
        ['expired', (i) => { i.attestation.expiresAt = i.context.now; }],
        ['future', (i) => { i.attestation.createdAt = '2026-10-14T20:01:00.000Z'; }],
        ['missing legacy scope', (i) => { i.attestation.legacyWriters = []; }],
        ['new legacy scope', (i) => { i.context.legacyScopes.push({ ...i.context.legacyScopes[0], scopeId: 'new' }); }],
        ['termination unverified', (i) => { i.attestation.legacyWriters[0].terminationVerified = false; }],
        ['lifetime not evidenced', (i) => { i.attestation.legacyWriters[0].lifetimeEvidenceDigest = null; }],
        ['observation shorter than worker lifetime', (i) => { i.attestation.legacyWriters[0].observedThrough = '2026-10-14T19:52:30.000Z'; }],
        ['nonterminal provider pagination', (i) => { i.attestation.inventory.pages.pop(); }],
        ['provider cursor gap', (i) => { i.attestation.inventory.pages[1].cursor = 'wrong'; }],
        ['uncertain operation optimistically settled', (i) => { i.attestation.inventory.operations[0].disposition = 'provider_verified_settled'; }],
        ['uncertain operation missing quarantine', (i) => { i.attestation.inventory.operations[0].disposition = 'reset'; }],
        ['payments enabled', (i) => { i.attestation.payments.backendEnabled = true; }],
    ])('HOLD: %s', (_label, mutate) => {
        const input = fixture(); mutate(input);
        expect(() => validate(input)).toThrow('HOLD:');
    });

    it.each(['exact_routine_inventory', 'routine_identity_and_acl', 'tables_closed_and_rls', 'billing_guard_enabled'])(
        'requires the complete existing AFTER schema gate: %s', (check) => {
            const input = fixture(); input.schema.receipt.stages[0].checks[check] = false;
            expect(() => validate(input)).toThrow('HOLD:');
        },
    );
});
