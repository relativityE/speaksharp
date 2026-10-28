import { createHash } from 'node:crypto';

const fail = (reason) => { throw new Error(`HOLD: ${reason}`); };
const sha = (value, length = 64) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const text = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
function closed(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail(`${label} schema`);
}
function time(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
        || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid timestamp');
    return Date.parse(value);
}
function unique(values, label) {
    if (!Array.isArray(values) || new Set(values).size !== values.length) fail(`duplicate ${label}`);
}
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    return value;
}
const serialize = (value) => JSON.stringify(canonical(value));
const sorted = (values) => [...values].sort((a, b) => serialize(a).localeCompare(serialize(b)));

// Caller supplies independently verified CURRENT facts. A digest binds identity;
// neither this validator nor SQL can infer platform termination/provider truth.
export function accountClosureBindingDigest(context) {
    return createHash('sha256').update(serialize({ candidateSha: context.candidateSha, mainSha: context.mainSha,
        migrationDigest: context.migrationDigest, target: context.target, configDigest: context.configDigest,
        deployments: sorted(context.deployments), legacyScopes: sorted(context.legacyScopes) })).digest('hex');
}

export function validateAccountClosureDrainAttestation(record, context) {
    closed(record, ['version', 'candidateSha', 'mainSha', 'migrationDigest', 'target', 'deployments', 'configDigest',
        'payments', 'operatorId', 'createdAt', 'expiresAt', 'evidenceDigest', 'bindingDigest', 'legacyWriters', 'inventory'], 'attestation');
    if (record.version !== 1 || !text(record.operatorId)) fail('version/operator');
    for (const key of ['candidateSha', 'mainSha', 'migrationDigest', 'configDigest', 'evidenceDigest']) {
        if (!sha(record[key], key.endsWith('Sha') ? 40 : 64) || record[key] !== context[key]) fail(`unverified ${key}`);
    }
    closed(record.target, ['projectId', 'environment'], 'target');
    if (!text(record.target.projectId) || !['production', 'disposable'].includes(record.target.environment)
        || serialize(record.target) !== serialize(context.target)) fail('target identity');
    if (!Array.isArray(record.deployments) || !record.deployments.length) fail('deployment inventory');
    for (const deployment of record.deployments) {
        closed(deployment, ['function', 'region', 'deploymentId', 'version', 'sha'], 'deployment');
        if (!['stripe-checkout', 'account-closure'].includes(deployment.function)
            || !text(deployment.region) || !text(deployment.deploymentId) || !text(deployment.version)
            || deployment.sha !== record.candidateSha) fail('deployment identity');
    }
    unique(record.deployments.map((item) => `${item.function}:${item.region}`), 'deployment scope');
    if (!['stripe-checkout', 'account-closure'].every((name) => record.deployments.some((item) => item.function === name))
        || serialize(sorted(record.deployments)) !== serialize(sorted(context.deployments))) fail('current deployment coverage');
    if (!sha(record.bindingDigest) || record.bindingDigest !== accountClosureBindingDigest(context)) fail('rollback/version/config binding');
    closed(record.payments, ['frontendEnabled', 'backendEnabled', 'evidenceDigest'], 'payment switches');
    if (record.payments.frontendEnabled !== false || record.payments.backendEnabled !== false
        || !sha(record.payments.evidenceDigest)) fail('payment switches not evidenced OFF');
    const created = time(record.createdAt); const expires = time(record.expiresAt); const now = time(context.now);
    if (created > now || expires <= now || expires <= created || expires - created > 15 * 60_000) fail('stale/future attestation');
    if (!Array.isArray(record.legacyWriters) || !Array.isArray(context.legacyScopes) || !context.legacyScopes.length) fail('legacy writer scope inventory missing');
    unique(context.legacyScopes.map((scope) => scope.scopeId), 'expected legacy writer');
    unique(record.legacyWriters.map((writer) => writer.scopeId), 'legacy writer');
    if (record.legacyWriters.length !== context.legacyScopes.length) fail('legacy writer scope coverage');
    for (const writer of record.legacyWriters) {
        closed(writer, ['scopeId', 'deploymentId', 'region', 'sha', 'executionLimitMs', 'backgroundLimitMs',
            'lastPossibleStartAt', 'observedThrough', 'terminationVerified', 'terminationEvidenceDigest', 'lifetimeEvidenceDigest'], 'legacy writer');
        const scope = context.legacyScopes.find((item) => item.scopeId === writer.scopeId);
        if (!scope || !text(writer.scopeId) || !text(writer.deploymentId) || !text(writer.region) || !sha(writer.sha, 40)
            || ['deploymentId', 'region', 'sha'].some((key) => scope[key] !== writer[key])) fail('legacy writer identity');
        if (writer.terminationVerified !== true || !sha(writer.terminationEvidenceDigest) || !sha(writer.lifetimeEvidenceDigest)) {
            fail(`missing verified termination/lifetime capability for ${writer.scopeId}`);
        }
        if (![writer.executionLimitMs, writer.backgroundLimitMs].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 86_400_000)) fail('effective lifetime missing');
        const start = time(writer.lastPossibleStartAt); const observed = time(writer.observedThrough);
        if (observed > created || observed < start + Math.max(writer.executionLimitMs, writer.backgroundLimitMs)) fail('legacy lifetime coverage');
    }
    closed(record.inventory, ['pages', 'completedAt', 'operations'], 'provider inventory');
    if (time(record.inventory.completedAt) > created || time(record.inventory.completedAt) < created - 15 * 60_000) fail('inventory observation freshness');
    if (!Array.isArray(record.inventory.pages) || !record.inventory.pages.length || record.inventory.pages.length > 1000) fail('inventory pagination');
    let cursor = null; const seen = new Set();
    for (const [index, page] of record.inventory.pages.entries()) {
        closed(page, ['cursor', 'nextCursor', 'evidenceDigest'], 'inventory page');
        if (page.cursor !== cursor || seen.has(cursor) || !sha(page.evidenceDigest)
            || (page.nextCursor !== null && !text(page.nextCursor))) fail('inventory cursor continuity');
        seen.add(cursor); cursor = page.nextCursor;
        if (cursor === null && index !== record.inventory.pages.length - 1) fail('premature terminal inventory page');
    }
    if (cursor !== null) fail('inventory not exhausted');
    if (!Array.isArray(record.inventory.operations)) fail('operation dispositions missing');
    unique(record.inventory.operations.map((item) => item.operationId), 'operation');
    const quarantined = [];
    for (const operation of record.inventory.operations) {
        closed(operation, ['operationId', 'userId', 'phase', 'disposition', 'evidenceDigest'], 'operation');
        if (![operation.operationId, operation.userId].every((value) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))
            || !sha(operation.evidenceDigest)) fail('operation ownership/evidence');
        if (operation.phase === 'settled') {
            if (operation.disposition !== 'provider_verified_settled') fail('settled operation lacks provider disposition');
        } else if (['issuing', 'unknown', 'open'].includes(operation.phase) && operation.disposition === 'quarantined') {
            quarantined.push({ operationId: operation.operationId, userId: operation.userId, phase: operation.phase });
        } else fail('uncertain operation cannot be settled/reset');
    }
    return { version: 1, validation: 'OFFLINE_VALID', bindingDigest: record.bindingDigest, evidenceDigest: record.evidenceDigest,
        quarantined, activationAuthorized: false };
}
