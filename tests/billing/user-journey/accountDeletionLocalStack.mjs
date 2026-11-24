// J1.f / J7.d on the DISPOSABLE billing local stack only: the deletion grant for this run, built once so the database seed and
// the functions' runtime bindings can never disagree. Never production: the target is the Supabase CLI stack's own gateway
// (http://kong:8000, which `supabase functions serve` sets as the function's SUPABASE_URL), the environment is `disposable`,
// and every validator refuses that combination on a hosted project (_shared/accountClosureLocalTarget.ts).
//
// What it produces, from the run's stack project and commit:
//   - the closure runtime binding (ACCOUNT_CLOSURE_RUNTIME_BINDING) and the completion runtime binding
//     (ACCOUNT_COMPLETION_RUNTIME_BINDING), both for one run-generated worker id (DENO_DEPLOYMENT_ID), as env-file lines;
//   - the seed SQL, the native full-chain fixtures' own enablement (tests/db/account-closure-enforcement-full-chain.sql,
//     tests/db/account-completion-full-chain-invariants.sql): record an OFFLINE_VALID drain attestation (deletion still off),
//     mark the disposable stack's checkout workers drained against it, then enable completion for exactly this scope.
// The attestation's validity window is the RPC's maximum (15 minutes), so `prepare` runs immediately before the journeys.
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

/** _shared/accountClosureRuntimeBinding.ts ACCOUNT_CLOSURE_RUNTIME_SCHEMA_SHA256 (a unit control keeps them equal). */
export const CLOSURE_SCHEMA_SHA256 = 'af9b30892558978c4adab16d5867ff0a5dd9afa4a377c66eb12f6ca25c88eeff';
/** _shared/accountClosureCompletionRuntimeBinding.ts ACCOUNT_COMPLETION_RUNTIME_SCHEMA_SHA256 (a unit control keeps them equal). */
export const COMPLETION_SCHEMA_SHA256 = 'dc21c7b3cdb1184ca945e75989bbc845b6e3aebc974292d14ac99bc767069781';
/** The only target this grant is for: the CLI stack's gateway, as the served function sees it. */
export const LOCAL_TARGET = 'http://kong:8000';
/** Below the attestation RPC's 15-minute maximum. */
export const GRANT_WINDOW_MS = 14 * 60_000;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const PROJECT = /^[a-z0-9-]{1,63}$/;
const COMMIT = /^[a-f0-9]{40}$/;

/**
 * Pure: the whole grant for one disposable run. `ids` and `now` are injectable for the unit controls; a real run takes fresh ones.
 */
export function buildDeletionGrant({ projectId, candidateSha, now = Date.now(), ids = {} }) {
    if (!PROJECT.test(String(projectId))) throw new Error('deletion grant: the stack project must be a plain lowercase id');
    if (!COMMIT.test(String(candidateSha))) throw new Error('deletion grant: the commit must be a full 40-character SHA');
    const attestationId = ids.attestationId ?? randomUUID();
    const deploymentId = `${projectId}_account-closure_${ids.worker ?? randomUUID().replace(/-/g, '')}`;
    const configDigest = sha256(`disposable-billing-local-stack:${projectId}:${candidateSha}`);
    const bindingDigest = ids.bindingDigest ?? sha256(`binding:${attestationId}`);
    const evidenceDigest = ids.evidenceDigest ?? sha256(`evidence:${attestationId}`);
    const closureContext = { candidateSha, configDigest, migrationDigest: CLOSURE_SCHEMA_SHA256, projectId, environment: 'disposable' };
    const closureManifest = { version: 1, deploymentId,
        scope: { attestationId, generation: '0', bindingDigest, context: closureContext } };
    const completionContext = { candidateSha, configDigest, migrationDigest: COMPLETION_SCHEMA_SHA256, projectId, environment: 'disposable' };
    // The completion binding's canonical tuple (accountClosureCompletionRuntimeBinding.ts), including the worker and target.
    const completionScopeDigest = sha256(JSON.stringify([1, deploymentId, candidateSha, configDigest, COMPLETION_SCHEMA_SHA256,
        projectId, 'disposable', LOCAL_TARGET]));
    const completionManifest = { version: 1, deploymentId, context: completionContext, scopeDigest: completionScopeDigest };
    const createdAt = new Date(now - 1_000).toISOString();
    const expiresAt = new Date(now + GRANT_WINDOW_MS).toISOString();
    // record_account_closure_drain_attestation's closed 15-key record and 6-key validation (20261016090000).
    const record = { version: 1, candidateSha, mainSha: candidateSha, migrationDigest: CLOSURE_SCHEMA_SHA256,
        target: { projectId, environment: 'disposable' }, deployments: [], configDigest,
        payments: { frontendEnabled: false, backendEnabled: false }, operatorId: 'disposable-billing-local-stack',
        createdAt, expiresAt, evidenceDigest, bindingDigest, legacyWriters: [], inventory: {} };
    const validation = { version: 1, validation: 'OFFLINE_VALID', activationAuthorized: false, bindingDigest, evidenceDigest, quarantined: [] };
    const env = {
        ACCOUNT_CLOSURE_RUNTIME_BINDING: JSON.stringify(closureManifest),
        ACCOUNT_COMPLETION_RUNTIME_BINDING: JSON.stringify(completionManifest),
        DENO_DEPLOYMENT_ID: deploymentId,
    };
    return { projectId, deploymentId, attestationId, completionScopeDigest, closureManifest, completionManifest, record, validation, env,
        expiresAt, seedSql: seedSql({ attestationId, record, validation, completionScopeDigest }) };
}

/** Dollar-quoted JSON (no tag inside the values: they are digests, ids, timestamps and fixed words). */
function jsonLiteral(value) {
    const text = JSON.stringify(value);
    if (text.includes('$grant$')) throw new Error('deletion grant: unexpected quoting tag in a value');
    return `$grant$${text}$grant$::jsonb`;
}

/** The disposable enablement, in the native full-chain fixtures' order. One transaction: all of it or none. */
export function seedSql({ attestationId, record, validation, completionScopeDigest }) {
    if (!/^[a-f0-9-]{36}$/.test(attestationId) || !/^[a-f0-9]{64}$/.test(completionScopeDigest)) throw new Error('deletion grant: malformed id');
    return [
        '\\set ON_ERROR_STOP on',
        'BEGIN;',
        'SET LOCAL ROLE service_role;',
        `SELECT public.record_account_closure_drain_attestation('${attestationId}'::uuid, 0, ${jsonLiteral(record)}, ${jsonLiteral(validation)});`,
        'RESET ROLE;',
        `UPDATE public.account_billing_coordination SET checkout_workers_drained=true, evidence_reference='${attestationId}'::uuid;`,
        `UPDATE public.account_completion_configuration SET enabled=true, scope_digest='${completionScopeDigest}';`,
        'COMMIT;',
        '',
    ].join('\n');
}

/** The env-file lines for `supabase functions serve --env-file` (none start with SUPABASE_, which the CLI reserves). */
export function envFileLines(env) {
    return Object.entries(env).map(([k, v]) => {
        if (/[\n\r]/.test(v)) throw new Error('deletion grant: env values are single-line');
        return `${k}=${v}`;
    });
}

// CLI: prepare --project <stack project> --commit <sha> --env-out <file to append> --sql-out <file>
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    const args = process.argv.slice(2);
    const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    try {
        if (args[0] !== 'prepare') throw new Error('usage: prepare --project P --commit SHA --env-out FILE --sql-out FILE');
        const grant = buildDeletionGrant({ projectId: flag('--project'), candidateSha: flag('--commit') });
        const envOut = flag('--env-out'); const sqlOut = flag('--sql-out');
        if (!envOut || !sqlOut) throw new Error('both --env-out and --sql-out are required');
        writeFileSync(envOut, `${envFileLines(grant.env).join('\n')}\n`, { flag: 'a', mode: 0o600 });
        writeFileSync(sqlOut, grant.seedSql, { mode: 0o600 });
        // Content-free: the window only.
        console.log(`ACCOUNT_DELETION_LOCAL_GRANT prepared; valid until ${grant.expiresAt}`);
    } catch (error) {
        console.error(`ACCOUNT_DELETION_LOCAL_GRANT refused: ${error instanceof Error ? error.message : 'unknown'}`);
        process.exitCode = 1;
    }
}
