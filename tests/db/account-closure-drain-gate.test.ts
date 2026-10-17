// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { accountClosureDrainQuery, accountClosureDrainInitialQuery, assertAccountClosureDrain } from '../../scripts/lib/accountClosureDrainGate.mjs';

const fixture = readFileSync('tests/db/account-closure-tokens.integration.test.ts', 'utf8').match(/await db\.exec\(`\n([\s\S]*?)`\);/)![1];
const closure = readFileSync('backend/supabase/migrations/20261013180000_account_closure_tokens.sql', 'utf8');
const drain = readFileSync('backend/supabase/migrations/20261016090000_account_closure_drain_persistence.sql', 'utf8');
let db: PGlite;
beforeEach(async () => {
    db = new PGlite(); await db.exec(fixture);
    await db.exec(`SET ROLE closure_owner; ${closure} RESET ROLE;`);
});
afterEach(async () => { await db.close(); });
async function verify(mode: string) {
    const query = mode === 'initial' ? accountClosureDrainInitialQuery : accountClosureDrainQuery(mode, drain);
    const output = await db.query<{ json_build_object: string }>(query);
    return assertAccountClosureDrain(output.rows[0].json_build_object, mode);
}
const apply = () => db.exec(`SET ROLE closure_owner; ${drain} RESET ROLE;`);

describe('read-only exact drain persistence postflight', () => {
    it('accepts absent before and exact fresh state after, in read-only snapshots', async () => {
        await verify('before'); await expect(verify('after')).rejects.toThrow();
        await apply(); await expect(verify('before')).rejects.toThrow();
        await db.exec('BEGIN READ ONLY');
        try { await verify('after'); await verify('initial'); } finally { await db.exec('ROLLBACK'); }
    });
    it.each([
        'CREATE TABLE account_closure_attestation_state(id int)',
        "CREATE FUNCTION record_account_closure_drain_attestation(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    ])('refuses partial pre-existing objects: %s', async (mutation) => {
        await db.exec(mutation); await expect(verify('before')).rejects.toThrow();
    });
    it.each([
        'ALTER TABLE account_closure_attestation_state DISABLE ROW LEVEL SECURITY',
        'GRANT SELECT ON account_closure_drain_attestations TO service_role',
        'GRANT SELECT(record) ON account_closure_drain_attestations TO authenticated',
        'GRANT SELECT(generation) ON account_closure_attestation_state TO PUBLIC',
        'CREATE POLICY unexpected ON account_closure_attestation_state USING(true)',
        'ALTER TABLE account_closure_attestation_state ALTER COLUMN generation SET DEFAULT 1',
        'ALTER TABLE account_closure_drain_attestations ALTER COLUMN record DROP NOT NULL',
        'ALTER TABLE account_closure_drain_attestations DROP CONSTRAINT account_closure_drain_attestations_binding_digest_check',
        'DROP TABLE account_closure_drain_attestations',
        'ALTER FUNCTION record_account_closure_drain_attestation(uuid,bigint,jsonb,jsonb) SECURITY INVOKER',
        'ALTER FUNCTION record_account_closure_drain_attestation(uuid,bigint,jsonb,jsonb) SET search_path=public',
        'GRANT EXECUTE ON FUNCTION invalidate_account_closure_drain_attestations(bigint,text,text) TO PUBLIC',
        'REVOKE EXECUTE ON FUNCTION invalidate_account_closure_drain_attestations(bigint,text,text) FROM service_role',
        "CREATE OR REPLACE FUNCTION invalidate_account_closure_drain_attestations(p_expected_generation bigint,p_reason text,p_evidence_digest text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN 0; END; $$",
        "CREATE FUNCTION invalidate_account_closure_drain_attestations(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
    ])('refuses catalog/ACL mutation: %s', async (mutation) => {
        await apply(); await verify('after');
        await db.exec(mutation); await expect(verify('after')).rejects.toThrow();
    });
    it.each([
        'UPDATE account_closure_attestation_state SET generation=1',
        "UPDATE account_closure_attestation_state SET binding_digest=repeat('a',64)",
        'DELETE FROM account_closure_attestation_state',
        "INSERT INTO account_closure_drain_attestations(attestation_id,generation,binding_digest,evidence_digest,record,validation,expires_at) VALUES(gen_random_uuid(),0,repeat('a',64),repeat('b',64),'{}','{}',now()+interval '1 minute')",
    ])('refuses noninitial persistent state: %s', async (mutation) => {
        await apply(); await verify('initial'); await db.exec(mutation);
        await expect(verify('initial')).rejects.toThrow();
    });
    it('rejects source drift and incomplete, null or false result rows', () => {
        expect(() => accountClosureDrainQuery('after', `${drain}\n`)).toThrow('checksum');
        expect(() => accountClosureDrainQuery('activate', drain)).toThrow('before or after');
        for (const value of [null, {}, { mode: 'drain-after', passed: true, checks: {} },
            { mode: 'drain-initial', passed: true, checks: { fresh_generation: true, empty_attestations: null } }]) {
            expect(() => assertAccountClosureDrain(value, 'initial')).toThrow();
        }
    });
});
