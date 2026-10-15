import { ACCOUNT_CLOSURE_SHA256 } from './accountClosureSchemaGate.mjs';
import { accountClosureBindingDigest } from './accountClosureDrainAttestation.mjs';
import { validateAccountClosureReleasePreflight } from './accountClosureReleasePreflight.mjs';

const maximumGeneration = 9223372036854775807n;
const reasons = new Set(['rollback', 'deployment_changed', 'config_changed', 'uncertain_writer', 'expired']);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const closed = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const sha = (v, length = 64) => typeof v === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(v);
const text = (v) => typeof v === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(v);
const uuid = (v) => typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
class Stop extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const stop = (reason) => { throw new Stop(reason); };
const held = (reason, mutationOutcome = 'not_attempted') => ({ status: 'HOLD', reason, mutationOutcome, activationAuthorized: false });
function generation(value, reason) {
    const v = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
    if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(v) || BigInt(v) > maximumGeneration) stop(reason);
    return v;
}

function currentFacts(value) {
    if (!closed(value, ['context', 'generation'])) stop('CONTEXT_INVALID');
    const c = value.context;
    const keys = ['candidateSha', 'mainSha', 'migrationDigest', 'target', 'configDigest', 'evidenceDigest', 'deployments', 'legacyScopes'];
    if (!object(c) || !keys.every((k) => Object.hasOwn(c, k))
        || Object.keys(c).some((k) => !keys.includes(k) && k !== 'now')
        || !sha(c.candidateSha, 40) || !sha(c.mainSha, 40) || c.migrationDigest !== ACCOUNT_CLOSURE_SHA256
        || !sha(c.configDigest) || !sha(c.evidenceDigest)
        || !closed(c.target, ['projectId', 'environment']) || !text(c.target.projectId)
        || !['production', 'disposable'].includes(c.target.environment)
        || !Array.isArray(c.deployments) || !c.deployments.length
        || !Array.isArray(c.legacyScopes) || !c.legacyScopes.length) stop('CONTEXT_INVALID');
    for (const d of c.deployments) {
        if (!closed(d, ['function', 'region', 'deploymentId', 'version', 'sha'])
            || !['stripe-checkout', 'account-closure'].includes(d.function)
            || ![d.region, d.deploymentId, d.version].every(text) || !sha(d.sha, 40)) stop('CONTEXT_INVALID');
    }
    for (const s of c.legacyScopes) {
        if (!closed(s, ['scopeId', 'deploymentId', 'region', 'sha'])
            || ![s.scopeId, s.deploymentId, s.region].every(text) || !sha(s.sha, 40)) stop('CONTEXT_INVALID');
    }
    if (!['stripe-checkout', 'account-closure'].every((name) => c.deployments.some((d) => d.function === name))
        || new Set(c.deployments.map((d) => `${d.function}:${d.region}`)).size !== c.deployments.length
        || new Set(c.legacyScopes.map((s) => s.scopeId)).size !== c.legacyScopes.length) stop('CONTEXT_INVALID');
    return { context: c, generation: generation(value.generation, 'CONTEXT_INVALID'),
        identity: `${accountClosureBindingDigest(c)}:${c.evidenceDigest}` };
}

/**
 * Injected trusted-service ports only:
 * getCurrentContext() -> { context: independently acquired facts, generation }.
 * rpc(name, arguments) -> { data: SQL scalar, error: null | database error }.
 * Generation is a canonical decimal string (safe integer inputs also accepted).
 * No credential discovery, collector, endpoint or automatic installation exists.
 * The trusted caller must bind both ports to the same independently verified
 * target and supply bounded port operations; a context object cannot prove that
 * a separately configured RPC client addresses the correct database.
 *
 * Client rechecks cannot atomically bind external deployment/config changes to
 * SQL. The existing RPC serializes its own locks/generation and checks time after
 * lock waits. An external release controller still must invalidate BEFORE change;
 * activation/closure consumers must independently recheck current state/expiry.
 * REGISTERED is a mutation receipt, never activation or current drain authority.
 * Returned validation/quarantine is private service data, never public diagnostics.
 */
export function createAccountClosureAttestationService(ports = {}) {
    const getCurrentContext = ports?.getCurrentContext; const rpc = ports?.rpc;
    async function readCurrent() {
        if (typeof getCurrentContext !== 'function' || typeof rpc !== 'function') stop('PORT_UNAVAILABLE');
        let snapshot;
        try { snapshot = structuredClone(await getCurrentContext()); } catch { stop('CONTEXT_UNAVAILABLE'); }
        return currentFacts(snapshot);
    }
    async function recheck(first, expected) {
        const next = await readCurrent();
        if (next.generation !== expected || first.generation !== expected || first.identity !== next.identity) stop('CONTEXT_DRIFT');
        return next;
    }
    function validate(input, current) {
        try {
            return validateAccountClosureReleasePreflight(input.schemaEvidence, input.attestation,
                { ...current.context, now: new Date().toISOString() });
        } catch { stop('EVIDENCE_INVALID'); }
    }
    async function mutate(name, args, accept) {
        try {
            const response = await rpc(name, structuredClone(args));
            if (!object(response) || !Object.hasOwn(response, 'data') || !Object.hasOwn(response, 'error')) {
                return held('RPC_OUTCOME_UNKNOWN', 'unknown');
            }
            if (response.error !== null) {
                if (response.data !== null) return held('RPC_OUTCOME_UNKNOWN', 'unknown');
                // Only explicit PostgreSQL statement rejection is definitive. Transport,
                // malformed and ambiguous responses never authorize a mutation replay.
                if (object(response.error) && ['P0001', '23505', '42501', '22023'].includes(response.error.code)) {
                    return held(response.error.code === 'P0001' && response.error.message === 'attestation identity conflict'
                        ? 'IDENTITY_CONFLICT' : 'RPC_REJECTED', 'rejected');
                }
                return held('RPC_OUTCOME_UNKNOWN', 'unknown');
            }
            return accept(response.data);
        } catch { return held('RPC_OUTCOME_UNKNOWN', 'unknown'); }
    }
    return {
        async register(request) {
            try {
                const input = structuredClone(request);
                if (!closed(input, ['attestationId', 'expectedGeneration', 'schemaEvidence', 'attestation'])
                    || !uuid(input.attestationId)) stop('REQUEST_INVALID');
                const expected = generation(input.expectedGeneration, 'REQUEST_INVALID');
                const first = await readCurrent();
                if (first.generation !== expected) stop('CONTEXT_DRIFT');
                validate(input, first);
                const current = await recheck(first, expected);
                const validation = validate(input, current);
                if (Date.parse(input.attestation.expiresAt) <= Date.now()) stop('EVIDENCE_INVALID');
                return await mutate('record_account_closure_drain_attestation', {
                    p_attestation_id: input.attestationId, p_expected_generation: expected,
                    p_record: input.attestation, p_validation: validation,
                }, (id) => {
                    if (id !== input.attestationId) stop('RESULT_INVALID');
                    return { status: 'REGISTERED', attestationId: id, generation: expected, validation, activationAuthorized: false };
                });
            } catch (error) { return held(error instanceof Stop ? error.reason : 'REQUEST_INVALID'); }
        },
        async invalidate(request) {
            try {
                const input = structuredClone(request);
                if (!closed(input, ['expectedGeneration', 'reason', 'evidenceDigest'])
                    || !reasons.has(input.reason) || !sha(input.evidenceDigest)) stop('REQUEST_INVALID');
                const expected = generation(input.expectedGeneration, 'REQUEST_INVALID');
                if (BigInt(expected) === maximumGeneration) stop('GENERATION_LIMIT');
                const first = await readCurrent();
                await recheck(first, expected);
                const next = String(BigInt(expected) + 1n);
                return await mutate('invalidate_account_closure_drain_attestations', {
                    p_expected_generation: expected, p_reason: input.reason, p_evidence_digest: input.evidenceDigest,
                }, (value) => {
                    if (generation(value, 'RESULT_INVALID') !== next) stop('RESULT_INVALID');
                    return { status: 'INVALIDATED', generation: next, activationAuthorized: false };
                });
            } catch (error) { return held(error instanceof Stop ? error.reason : 'REQUEST_INVALID'); }
        },
    };
}
