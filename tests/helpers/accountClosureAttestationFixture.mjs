// Synthetic protocol fixture only. Never provider provenance or authorization.
import { ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 } from '../../scripts/lib/accountClosureEnforcementIdentity.mjs';
import { accountClosureBindingDigest } from '../../scripts/lib/accountClosureDrainAttestation.mjs';
import { enforcedClosureReceipt } from '../helpers/accountClosureEnforcementReceipt.mjs';

const id = '11111111-1111-4111-8111-111111111111';
export function fixture() {
    const at = (offset) => new Date(Date.now() + offset).toISOString();
    const deployments = ['stripe-checkout', 'account-closure'].map((name) => ({ function: name, region: 'us-east-1',
        deploymentId: name, version: 'v2', sha: 'a'.repeat(40) }));
    const legacyScopes = [{ scopeId: 'checkout-old', deploymentId: 'checkout-v1', region: 'us-east-1', sha: 'b'.repeat(40) }];
    const context = { candidateSha: 'a'.repeat(40), mainSha: 'c'.repeat(40), migrationDigest: ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256,
        configDigest: 'e'.repeat(64), evidenceDigest: 'f'.repeat(64), target: { projectId: 'project-test', environment: 'disposable' },
        deployments, legacyScopes };
    const attestation = { version: 1, ...context, bindingDigest: accountClosureBindingDigest(context),
        payments: { frontendEnabled: false, backendEnabled: false, evidenceDigest: '1'.repeat(64) }, operatorId: 'fixture',
        createdAt: at(-5000), expiresAt: at(300000),
        legacyWriters: [{ ...legacyScopes[0], executionLimitMs: 400000, backgroundLimitMs: 400000,
            lastPossibleStartAt: at(-600000), observedThrough: at(-10000), terminationVerified: true,
            terminationEvidenceDigest: '2'.repeat(64), lifetimeEvidenceDigest: '3'.repeat(64) }],
        inventory: { completedAt: at(-15000), pages: [{ cursor: null, nextCursor: null, evidenceDigest: '4'.repeat(64) }],
            operations: [{ operationId: id, userId: '22222222-2222-4222-8222-222222222222', phase: 'unknown',
                disposition: 'quarantined', evidenceDigest: '6'.repeat(64) }] } };
    delete attestation.legacyScopes;
    return { current: { context, generation: '7' }, request: { attestationId: id, expectedGeneration: '7', attestation,
        schemaEvidence: { candidateSha: context.candidateSha, mainSha: context.mainSha, migrationDigest: context.migrationDigest,
            target: context.target, receipt: enforcedClosureReceipt() } } };
}

