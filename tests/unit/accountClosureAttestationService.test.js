// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 as ACCOUNT_CLOSURE_SHA256 } from '../../scripts/lib/accountClosureEnforcementIdentity.mjs';
import { enforcedClosureReceipt } from '../helpers/accountClosureEnforcementReceipt.mjs';
import { accountClosureBindingDigest } from '../../scripts/lib/accountClosureDrainAttestation.mjs';
import { validateAccountClosureReleasePreflight } from '../../scripts/lib/accountClosureReleasePreflight.mjs';
import { createAccountClosureAttestationService } from '../../scripts/lib/accountClosureAttestationService.mjs';

const hash = (letter, length = 64) => letter.repeat(length);
const id = '11111111-1111-4111-8111-111111111111';
const at = (offset = 0) => new Date(Date.now() + offset).toISOString();
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime('2026-10-15T20:00:00.000Z'); });
afterEach(() => { vi.useRealTimers(); });

function fixture() {
    const deployments = ['stripe-checkout', 'account-closure'].map((name) => ({ function: name, region: 'us-east-1',
        deploymentId: name, version: 'v2', sha: hash('a', 40) }));
    const legacyScopes = [{ scopeId: 'checkout-old', deploymentId: 'checkout-v1', region: 'us-east-1', sha: hash('b', 40) }];
    const context = { candidateSha: hash('a', 40), mainSha: hash('c', 40), migrationDigest: ACCOUNT_CLOSURE_SHA256,
        configDigest: hash('e'), evidenceDigest: hash('f'), target: { projectId: 'project-test', environment: 'disposable' },
        deployments, legacyScopes, now: at() };
    const attestation = { version: 1, candidateSha: context.candidateSha, mainSha: context.mainSha,
        migrationDigest: context.migrationDigest, target: context.target, deployments, configDigest: context.configDigest,
        bindingDigest: accountClosureBindingDigest(context), evidenceDigest: context.evidenceDigest,
        payments: { frontendEnabled: false, backendEnabled: false, evidenceDigest: hash('1') }, operatorId: 'operator-test',
        createdAt: at(-5000), expiresAt: at(300000),
        legacyWriters: [{ ...legacyScopes[0], executionLimitMs: 400000, backgroundLimitMs: 400000,
            lastPossibleStartAt: at(-600000), observedThrough: at(-10000),
            terminationVerified: true, terminationEvidenceDigest: hash('2'), lifetimeEvidenceDigest: hash('3') }],
        inventory: { completedAt: at(-15000), pages: [{ cursor: null, nextCursor: null, evidenceDigest: hash('4') }],
            operations: [{ operationId: id, userId: '22222222-2222-4222-8222-222222222222',
                phase: 'unknown', disposition: 'quarantined', evidenceDigest: hash('6') }] } };
    const schemaEvidence = { candidateSha: context.candidateSha, mainSha: context.mainSha, migrationDigest: ACCOUNT_CLOSURE_SHA256,
        target: context.target, receipt: enforcedClosureReceipt() };
    return structuredClone({ request: { attestationId: id, expectedGeneration: '7', schemaEvidence, attestation }, current: { context, generation: '7' } });
}

function setup(input = fixture()) {
    const getCurrentContext = vi.fn(async () => structuredClone(input.current));
    const rpc = vi.fn(async () => ({ data: id, error: null }));
    return { ...input, getCurrentContext, rpc, service: createAccountClosureAttestationService({ getCurrentContext, rpc }) };
}
const hold = (reason, mutationOutcome = 'not_attempted') => ({ status: 'HOLD', reason, mutationOutcome, activationAuthorized: false });
const invalidate = () => ({ expectedGeneration: '7', reason: 'deployment_changed', evidenceDigest: hash('d') });

describe('trusted account-closure attestation adapter — injected ports, no live database/provider proof', () => {
    it('validates first and sends exact SQL arguments and the six-key validation, preserving private quarantine', async () => {
        const s = setup(); const before = structuredClone(s.request);
        const validation = validateAccountClosureReleasePreflight(s.request.schemaEvidence, s.request.attestation, s.current.context);
        const result = await s.service.register(s.request);
        expect(result).toEqual({ status: 'REGISTERED', attestationId: id, generation: '7', validation, activationAuthorized: false });
        expect(s.getCurrentContext).toHaveBeenCalledTimes(2);
        expect(s.rpc).toHaveBeenCalledExactlyOnceWith('record_account_closure_drain_attestation', {
            p_attestation_id: id, p_expected_generation: '7', p_record: before.attestation, p_validation: validation,
        });
        expect(Object.keys(s.rpc.mock.calls[0][1].p_validation)).toHaveLength(6);
        expect(s.rpc.mock.calls[0][1].p_validation).not.toHaveProperty('checkedAt');
        expect(s.request).toEqual(before);
    });

    it.each([
        ['schema success flag alone', (s) => { s.request.schemaEvidence.receipt = { passed: true }; }],
        ['failed disabled stage', (s) => { s.request.schemaEvidence.receipt.stages[4].checks.rollout_disabled = false; }],
        ['expired under actual clock despite old context.now', (s) => { s.request.attestation.expiresAt = at(); s.current.context.now = at(-1000); }],
        ['wrong current release', (s) => { s.current.context.candidateSha = hash('b', 40); }],
        ['wrong independent evidence digest', (s) => { s.current.context.evidenceDigest = hash('b'); }],
        ['unverified worker lifetime', (s) => { s.request.attestation.legacyWriters[0].terminationVerified = false; }],
        ['unexhausted provider inventory', (s) => { s.request.attestation.inventory.pages[0].nextCursor = 'missing'; }],
        ['uncertain operation reset', (s) => { s.request.attestation.inventory.operations[0].disposition = 'reset'; }],
    ])('makes zero registration calls for %s', async (_name, mutate) => {
        const s = setup(); mutate(s);
        expect(await s.service.register(s.request)).toEqual(hold('EVIDENCE_INVALID'));
        expect(s.rpc).not.toHaveBeenCalled();
    });

    it.each([
        ['missing port result', () => undefined], ['success flag only', () => ({ passed: true })],
        ['missing generation', (s) => ({ context: s.current.context })],
        ['incomplete independent facts', () => ({ context: {}, generation: '7' })],
        ['wrong migration digest', (s) => ({ ...s.current, context: { ...s.current.context, migrationDigest: hash('b') } })],
        ['unsafe integer generation', (s) => ({ ...s.current, generation: Number.MAX_SAFE_INTEGER + 1 })],
    ])('holds an unavailable/incomplete context: %s', async (_name, response) => {
        const s = setup(); s.getCurrentContext.mockImplementation(async () => response(s));
        expect(await s.service.register(s.request)).toEqual(hold('CONTEXT_INVALID'));
        expect(s.rpc).not.toHaveBeenCalled();
    });

    it('does not fall back to request-supplied current facts when ports are absent or throw', async () => {
        const s = setup(); const unavailable = createAccountClosureAttestationService();
        expect(await unavailable.register(s.request)).toEqual(hold('PORT_UNAVAILABLE'));
        s.getCurrentContext.mockRejectedValue(new Error('DO_NOT_ECHO_TOKEN_OR_CONTEXT'));
        expect(await s.service.register(s.request)).toEqual(hold('CONTEXT_UNAVAILABLE'));
        expect(s.rpc).not.toHaveBeenCalled();
    });

    it.each(['generation', 'binding', 'evidence'])('rejects %s drift at the second current-context read', async (kind) => {
        const s = setup(); const second = structuredClone(s.current);
        if (kind === 'generation') second.generation = '8';
        if (kind === 'binding') second.context.deployments[0].version = 'changed';
        if (kind === 'evidence') second.context.evidenceDigest = hash('9');
        s.getCurrentContext.mockResolvedValueOnce(s.current).mockResolvedValueOnce(second);
        expect(await s.service.register(s.request)).toEqual(hold('CONTEXT_DRIFT'));
        expect(s.rpc).not.toHaveBeenCalled();
    });

    it('checks actual freshness again after waiting for the final context port', async () => {
        const s = setup(); s.getCurrentContext.mockResolvedValueOnce(s.current).mockImplementationOnce(async () => {
            vi.setSystemTime(Date.now() + 300001); return s.current;
        });
        expect(await s.service.register(s.request)).toEqual(hold('EVIDENCE_INVALID'));
        expect(s.rpc).not.toHaveBeenCalled();
    });

    it('snapshots caller input before awaiting context and isolates validation from mutation by the RPC port', async () => {
        const s = setup(); const original = structuredClone(s.request);
        s.getCurrentContext.mockImplementationOnce(async () => { s.request.attestation.operatorId = 'changed'; return s.current; });
        s.rpc.mockImplementation(async (_name, args) => { args.p_validation.activationAuthorized = true; return { data: id, error: null }; });
        const result = await s.service.register(s.request);
        expect(result.status).toBe('REGISTERED'); expect(result.validation.activationAuthorized).toBe(false);
        expect(s.rpc.mock.calls[0][1].p_record).toEqual(original.attestation);
    });

    it.each([undefined, {}, { data: null, error: null }, { data: [id], error: null }, { data: hash('a'), error: null },
        { data: '33333333-3333-4333-8333-333333333333', error: null },
        { data: id, error: { code: 'P0001', message: 'attestation identity conflict' } },
        { data: id, error: { code: 'ETIMEDOUT', message: 'DO_NOT_ECHO_CUSTOMER_OR_TOKEN' } }])(
        'holds malformed/ambiguous registration response without a receipt or automatic retry: %j', async (response) => {
            const s = setup(); s.rpc.mockResolvedValue(response);
            expect(await s.service.register(s.request)).toEqual(hold('RPC_OUTCOME_UNKNOWN', 'unknown'));
            expect(s.rpc).toHaveBeenCalledTimes(1);
        },
    );

    it('keeps an unreadable response after dispatch unknown, never falsely not-attempted', async () => {
        const s = setup(); const response = { data: id };
        Object.defineProperty(response, 'error', { get() { throw new Error('DO_NOT_ECHO_RESPONSE_FAILURE'); } });
        s.rpc.mockResolvedValue(response);
        expect(await s.service.register(s.request)).toEqual(hold('RPC_OUTCOME_UNKNOWN', 'unknown'));
        expect(s.rpc).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['invalid ID', (r) => { r.attestationId = 'not-a-uuid'; }],
        ['caller success override', (r) => { r.passed = true; }],
        ['unsafe generation', (r) => { r.expectedGeneration = Number.MAX_SAFE_INTEGER + 1; }],
    ])('refuses an invalid request before any registration: %s', async (_name, mutate) => {
        const s = setup(); mutate(s.request);
        expect(await s.service.register(s.request)).toEqual(hold('REQUEST_INVALID'));
        expect(s.rpc).not.toHaveBeenCalled();
    });

    it('does not retry a lost mutation response; explicit retry preserves the same ID and SQL inputs', async () => {
        const s = setup(); s.rpc.mockRejectedValueOnce(new Error('DO_NOT_ECHO_PROVIDER_ERROR'));
        expect(await s.service.register(s.request)).toEqual(hold('RPC_OUTCOME_UNKNOWN', 'unknown'));
        expect(s.rpc).toHaveBeenCalledTimes(1);
        expect((await s.service.register(s.request)).status).toBe('REGISTERED');
        expect(s.rpc).toHaveBeenCalledTimes(2);
        expect(s.rpc.mock.calls[1]).toEqual(s.rpc.mock.calls[0]);
    });

    it('reports an explicit SQL identity conflict as rejection, never idempotent success', async () => {
        const s = setup(); s.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'attestation identity conflict' } });
        expect(await s.service.register(s.request)).toEqual(hold('IDENTITY_CONFLICT', 'rejected'));
        expect(s.rpc).toHaveBeenCalledTimes(1);
    });

    it('reports a SQL error without leaking database details', async () => {
        const s = setup(); s.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'DO_NOT_ECHO_RAW_CONTEXT' } });
        expect(await s.service.register(s.request)).toEqual(hold('RPC_REJECTED', 'rejected'));
        expect(s.rpc).toHaveBeenCalledTimes(1);
    });

    it.each(['rollback', 'deployment_changed', 'config_changed', 'uncertain_writer', 'expired'])(
        'explicitly invalidates with the exact reason/generation/digest: %s', async (reason) => {
            const s = setup(); s.rpc.mockResolvedValue({ data: 8, error: null });
            expect(await s.service.invalidate({ ...invalidate(), reason })).toEqual({ status: 'INVALIDATED', generation: '8', activationAuthorized: false });
            expect(s.getCurrentContext).toHaveBeenCalledTimes(2);
            expect(s.rpc).toHaveBeenCalledExactlyOnceWith('invalidate_account_closure_drain_attestations', {
                p_expected_generation: '7', p_reason: reason, p_evidence_digest: hash('d'),
            });
        },
    );

    it.each(['unknown', null, 'deployment_changed; enable deletion'])('rejects unsupported invalidation reason %s before mutation', async (reason) => {
        const s = setup(); expect(await s.service.invalidate({ ...invalidate(), reason })).toEqual(hold('REQUEST_INVALID'));
        expect(s.rpc).not.toHaveBeenCalled();
    });

    it.each([null, '7', '9', [], Number.MAX_SAFE_INTEGER + 1])('holds a malformed or wrong next generation: %j', async (value) => {
        const s = setup(); s.rpc.mockResolvedValue({ data: value, error: null });
        expect(await s.service.invalidate(invalidate())).toEqual(hold('RPC_OUTCOME_UNKNOWN', 'unknown'));
        expect(s.rpc).toHaveBeenCalledTimes(1);
    });

    it('preserves bigint generation exactly, and refuses SQL bigint overflow before mutation', async () => {
        const s = setup(); s.current.generation = '9007199254740992';
        s.rpc.mockResolvedValue({ data: '9007199254740993', error: null });
        expect(await s.service.invalidate({ ...invalidate(), expectedGeneration: s.current.generation }))
            .toEqual({ status: 'INVALIDATED', generation: '9007199254740993', activationAuthorized: false });
        expect(s.rpc.mock.calls[0][1].p_expected_generation).toBe('9007199254740992');
        s.rpc.mockClear();
        expect(await s.service.invalidate({ ...invalidate(), expectedGeneration: '9223372036854775807' })).toEqual(hold('GENERATION_LIMIT'));
        expect(s.rpc).not.toHaveBeenCalled();
    });

    it('does not replay uncertain invalidation or register as a side effect', async () => {
        const s = setup(); s.rpc.mockRejectedValue(new Error('lost response'));
        expect(await s.service.invalidate(invalidate())).toEqual(hold('RPC_OUTCOME_UNKNOWN', 'unknown'));
        expect(s.rpc).toHaveBeenCalledTimes(1);
        expect(s.rpc.mock.calls[0][0]).toBe('invalidate_account_closure_drain_attestations');
    });

    it('holds invalidation on observed current generation drift and invalid evidence digest', async () => {
        const s = setup(); s.getCurrentContext.mockResolvedValueOnce(s.current)
            .mockResolvedValueOnce({ ...s.current, generation: '8' });
        expect(await s.service.invalidate(invalidate())).toEqual(hold('CONTEXT_DRIFT'));
        expect(await s.service.invalidate({ ...invalidate(), evidenceDigest: 'not-a-digest' })).toEqual(hold('REQUEST_INVALID'));
        expect(s.rpc).not.toHaveBeenCalled();
    });
});
