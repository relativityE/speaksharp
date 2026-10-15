import { ACCOUNT_CLOSURE_SHA256, assertAccountClosureTerminal } from './accountClosureSchemaGate.mjs';
import { assertAccountClosureRollout } from './accountClosureRolloutGate.mjs';
import { validateAccountClosureDrainAttestation } from './accountClosureDrainAttestation.mjs';

const hold = (reason) => { throw new Error(`HOLD: ${reason}`); };
function closed(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
        hold(`invalid ${name}`);
    }
}

/**
 * Pure OFFLINE composition, not a collector or an installed deployment guard.
 * schemaEvidence wraps the existing composed AFTER receipt with candidateSha,
 * mainSha, migrationDigest and target. The caller must obtain currentContext
 * independently; matching caller-supplied values do not establish live truth.
 * Synthetic success proves composition only and never authorizes activation.
 *
 * Drain validator is unchanged from 1126566f0747b3359c5ac11966b9093a99af747d,
 * blob 8e65006d82bc81187f09754483f86f3c5bf68305.
 */
export function validateAccountClosureReleasePreflight(schemaEvidence, attestation, currentContext) {
    closed(schemaEvidence, ['candidateSha', 'mainSha', 'migrationDigest', 'target', 'receipt'], 'schema evidence');
    if (!currentContext || typeof currentContext !== 'object' || Array.isArray(currentContext)) hold('current context required');
    for (const key of ['candidateSha', 'mainSha']) {
        if (typeof schemaEvidence[key] !== 'string' || !/^[a-f0-9]{40}$/.test(schemaEvidence[key])
            || schemaEvidence[key] !== currentContext[key]) hold(`schema ${key} mismatch`);
    }
    if (schemaEvidence.migrationDigest !== ACCOUNT_CLOSURE_SHA256
        || schemaEvidence.migrationDigest !== currentContext.migrationDigest) hold('schema migration digest mismatch');
    closed(schemaEvidence.target, ['projectId', 'environment'], 'schema target');
    closed(currentContext.target, ['projectId', 'environment'], 'current target');
    if (['projectId', 'environment'].some((key) => schemaEvidence.target[key] !== currentContext.target[key])) hold('schema target mismatch');

    const receipt = schemaEvidence.receipt;
    closed(receipt, ['mode', 'passed', 'stages'], 'composed schema receipt');
    if (receipt.mode !== 'after' || receipt.passed !== true || !Array.isArray(receipt.stages)
        || receipt.stages.length !== 3) hold('incomplete AFTER schema receipt');
    for (const stage of receipt.stages) closed(stage, ['mode', 'passed', 'checks'], 'schema stage');
    try {
        assertAccountClosureTerminal(receipt.stages.slice(0, 2), 'after');
        assertAccountClosureRollout(receipt.stages[2], 'after');
    } catch {
        hold('composed AFTER schema verification failed');
    }
    return validateAccountClosureDrainAttestation(attestation, currentContext);
}
