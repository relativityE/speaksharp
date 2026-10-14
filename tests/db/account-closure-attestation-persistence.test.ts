// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const fixture = readFileSync('tests/db/account-closure-tokens.integration.test.ts', 'utf8')
    .match(/await db\.exec\(`\n([\s\S]*?)`\);/)![1];
const migration = readFileSync('backend/supabase/migrations/20261013180000_account_closure_tokens.sql', 'utf8');
const proposal = readFileSync('scripts/rollout/account-closure-attestation-proposal.sql', 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
beforeEach(async () => { db = new PGlite(); await db.exec(fixture); await db.exec(`SET ROLE closure_owner; ${migration} ${proposal} RESET ROLE;`); });
afterEach(async () => { await db.close(); });
function inputs() {
    // SQL does NOT independently validate platform facts. This deliberately
    // exercises its trusted-service persistence contract; JS validator separately
    // tests full external-evidence shape/semantics before this RPC may be called.
    const now = Date.now();
    const record = { version: 1, candidateSha: 'a'.repeat(40), mainSha: 'b'.repeat(40), migrationDigest: 'c'.repeat(64),
        target: {}, deployments: [], configDigest: 'd'.repeat(64), payments: { frontendEnabled: false, backendEnabled: false },
        operatorId: 'test-operator', createdAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 600000).toISOString(),
        evidenceDigest: 'e'.repeat(64), bindingDigest: 'f'.repeat(64), legacyWriters: [], inventory: {} };
    const validation = { version: 1, validation: 'OFFLINE_VALID', activationAuthorized: false,
        bindingDigest: record.bindingDigest, evidenceDigest: record.evidenceDigest, quarantined: [] };
    return { record, validation };
}
async function register(record: object, validation: object, generation = 0, request = id, role = 'service_role') {
    return db.transaction(async (tx) => {
        await tx.exec(`SET LOCAL ROLE ${role}`);
        return tx.query('SELECT record_account_closure_drain_attestation($1,$2,$3::jsonb,$4::jsonb) AS id',
            [request, generation, JSON.stringify(record), JSON.stringify(validation)]);
    });
}
async function invalidate(generation = 0, reason = 'rollback') {
    return db.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE service_role');
        return tx.query('SELECT invalidate_account_closure_drain_attestations($1,$2,$3) AS generation', [generation, reason, 'a'.repeat(64)]);
    });
}
describe('proposed atomic attestation persistence — isolated SQL, no activation path', () => {
    it('registers exact service evidence idempotently without enabling deletion', async () => {
        const { record, validation } = inputs();
        expect((await register(record, validation)).rows).toEqual([{ id }]);
        await register(record, validation);
        expect((await db.query('SELECT count(*)::int AS n FROM account_closure_drain_attestations')).rows).toEqual([{ n: 1 }]);
        expect((await db.query('SELECT checkout_workers_drained FROM account_billing_coordination')).rows).toEqual([{ checkout_workers_drained: false }]);
    });
    it.each(['anon', 'authenticated'])('rejects %s RPC and direct journal access', async (role) => {
        const { record, validation } = inputs();
        await expect(register(record, validation, 0, id, role)).rejects.toThrow('permission denied');
        await expect(db.transaction(async (tx) => { await tx.exec(`SET LOCAL ROLE ${role}`); return tx.query('SELECT * FROM account_closure_drain_attestations'); })).rejects.toThrow('permission denied');
    });
    it('rejects service direct table writes as well', async () => {
        await expect(db.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE service_role'); return tx.query('UPDATE account_closure_attestation_state SET generation=99'); })).rejects.toThrow('permission denied');
    });
    it('atomically invalidates and disables; stale generation cannot register or retry invalidation', async () => {
        const { record, validation } = inputs(); await register(record, validation);
        await db.exec("UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='simulated-future-activation-only'");
        expect((await invalidate()).rows).toEqual([{ generation: 1 }]);
        await expect(register(record, validation)).rejects.toThrow('stale attestation generation');
        await expect(invalidate()).rejects.toThrow('stale invalidation generation');
        expect((await db.query('SELECT checkout_workers_drained,evidence_reference FROM account_billing_coordination')).rows)
            .toEqual([{ checkout_workers_drained: false, evidence_reference: null }]);
        expect((await db.query('SELECT invalidation_reason FROM account_closure_drain_attestations')).rows).toEqual([{ invalidation_reason: 'rollback' }]);
    });
    it('rejects changed binding without explicit invalidation and preserves prior record', async () => {
        const { record, validation } = inputs(); await register(record, validation);
        record.bindingDigest = 'a'.repeat(64); validation.bindingDigest = record.bindingDigest;
        await expect(register(record, validation, 0, other)).rejects.toThrow('binding change requires invalidation');
        await invalidate(); await register(record, validation, 1, other);
    });
    it.each(['rollback', 'deployment_changed', 'config_changed', 'uncertain_writer', 'expired'])('records %s invalidation', async (reason) => {
        const { record, validation } = inputs(); await register(record, validation); await invalidate(0, reason);
        expect((await db.query('SELECT invalidation_reason FROM account_closure_drain_attestations')).rows).toEqual([{ invalidation_reason: reason }]);
    });
    it('rolls back rejected registration without advancing the binding', async () => {
        const { record, validation } = inputs(); validation.activationAuthorized = true;
        await expect(register(record, validation)).rejects.toThrow('validated service evidence required');
        expect((await db.query('SELECT generation,binding_digest FROM account_closure_attestation_state')).rows).toEqual([{ generation: 0, binding_digest: null }]);
    });
    it('refuses registration while deletion is enabled or coordination is missing', async () => {
        const { record, validation } = inputs();
        await db.exec('UPDATE account_billing_coordination SET checkout_workers_drained=true');
        await expect(register(record, validation)).rejects.toThrow('deletion must remain disabled');
        await db.exec('DELETE FROM account_billing_coordination');
        await expect(register(record, validation)).rejects.toThrow('deletion must remain disabled');
    });
    it('rejects null identity and stale timestamps', async () => {
        const { record, validation } = inputs();
        await expect(register({ ...record, candidateSha: null }, validation)).rejects.toThrow('invalid attestation');
        await expect(register({ ...record, expiresAt: new Date(Date.now() - 1000).toISOString() }, validation)).rejects.toThrow('stale attestation');
        await expect(register({ ...record, unexpected: true }, validation)).rejects.toThrow('invalid attestation');
    });
});
