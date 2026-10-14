// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { accountClosureSchemaQuery, accountClosureDisabledQuery, assertAccountClosureSchema, assertAccountClosureTerminal } from '../../scripts/lib/accountClosureSchemaGate.mjs';

const source = readFileSync('backend/supabase/migrations/20261013180000_account_closure_tokens.sql', 'utf8');
const fixture = readFileSync('tests/db/account-closure-tokens.integration.test.ts', 'utf8')
    .match(/await db\.exec\(`\n([\s\S]*?)`\);/)![1];
let db: PGlite;
beforeEach(async () => { db = new PGlite(); await db.exec(fixture); });
afterEach(async () => { await db.close(); });
async function verify(mode: string) {
    const result = await db.query<{ json_build_object: string }>(accountClosureSchemaQuery(mode, source));
    return assertAccountClosureSchema(result.rows[0].json_build_object, mode);
}
async function apply() { await db.exec(`SET ROLE closure_owner; ${source} RESET ROLE;`); }
async function disabled() {
    const result = await db.query<{ json_build_object: string }>(accountClosureDisabledQuery);
    return assertAccountClosureSchema(result.rows[0].json_build_object, 'disabled');
}

describe('account closure read-only schema gate', () => {
    it('accepts before only on an absent schema, then after only on the exact disabled schema', async () => {
        await verify('before');
        await expect(verify('after')).rejects.toThrow();
        await apply();
        await expect(verify('before')).rejects.toThrow();
        await verify('after'); await disabled();
    });
    it('rejects partial schema before apply', async () => {
        await db.exec('CREATE TABLE account_closure_tokens(id int)');
        await expect(verify('before')).rejects.toThrow();
    });
    it.each([
        'ALTER TABLE account_closure_tokens DISABLE ROW LEVEL SECURITY',
        'GRANT SELECT ON account_closure_tokens TO authenticated',
        'GRANT EXECUTE ON FUNCTION claim_account_closure_token(uuid,text) TO PUBLIC',
        'ALTER FUNCTION claim_account_closure_token(uuid,text) SECURITY INVOKER',
        "ALTER FUNCTION claim_account_closure_token(uuid,text) SET search_path TO public",
        'ALTER TABLE user_profiles DISABLE TRIGGER account_closure_billing_guard',
        'DROP TRIGGER account_closure_billing_guard ON user_profiles; CREATE TRIGGER account_closure_billing_guard BEFORE INSERT ON user_profiles FOR EACH ROW EXECUTE FUNCTION guard_account_closure_billing()',
        'DROP TRIGGER account_closure_billing_guard ON user_profiles; CREATE TRIGGER account_closure_billing_guard BEFORE INSERT OR UPDATE ON user_profiles FOR EACH ROW WHEN(false) EXECUTE FUNCTION guard_account_closure_billing()',
        'DROP TRIGGER account_closure_billing_guard ON user_profiles; CREATE TRIGGER account_closure_billing_guard AFTER INSERT OR UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION guard_account_closure_billing()',
        'DROP TRIGGER account_closure_billing_guard ON user_profiles; CREATE TRIGGER account_closure_billing_guard BEFORE INSERT OR UPDATE OF stripe_customer_id ON user_profiles FOR EACH ROW EXECUTE FUNCTION guard_account_closure_billing()',
        'CREATE POLICY unexpected ON account_closure_tokens USING (true)',
        "CREATE FUNCTION claim_account_closure_token(integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'",
        'DROP TABLE account_closure_billing_permits',
        "CREATE OR REPLACE FUNCTION public.begin_account_checkout(p_user_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN NULL; END; $$",
    ])('rejects deployed mutation: %s', async (mutation) => {
        await apply(); await verify('after');
        await db.exec(mutation);
        await expect(verify('after')).rejects.toThrow();
    });
    it.each([
        "UPDATE account_billing_coordination SET checkout_workers_drained=true,evidence_reference='unproved'",
        "UPDATE account_billing_coordination SET evidence_reference='unproved'",
        'DELETE FROM account_billing_coordination',
    ])('rejects activation-state mutation: %s', async (mutation) => {
        await apply(); await disabled(); await db.exec(mutation);
        await expect(disabled()).rejects.toThrow();
    });
    it('works under a read-only transaction and does not invoke any account RPC', async () => {
        await apply();
        await db.exec('BEGIN READ ONLY');
        try { await verify('after'); await disabled(); } finally { await db.exec('ROLLBACK'); }
        expect((await db.query('SELECT count(*)::int AS n FROM account_closure_attempts')).rows).toEqual([{ n: 0 }]);
    });
    it('rejects changed migration bytes and malformed or incomplete gate results', () => {
        expect(() => accountClosureSchemaQuery('after', `${source}\n`)).toThrow('checksum');
        expect(() => accountClosureSchemaQuery('activate', source)).toThrow('before or after');
        expect(() => assertAccountClosureSchema({ mode: 'after', passed: true, checks: {} }, 'after')).toThrow();
        expect(() => assertAccountClosureSchema({ mode: 'before', passed: true, checks: {} }, 'after')).toThrow();
    });
    it('cannot return overall PASS before the disabled stage succeeds', async () => {
        await apply();
        const output = (await db.query<{ json_build_object: string }>(accountClosureSchemaQuery('after', source))).rows[0].json_build_object;
        expect(() => assertAccountClosureTerminal([output], 'after')).toThrow('incomplete');
        expect(() => assertAccountClosureTerminal([output, { mode: 'disabled', passed: false, checks: { rollout_disabled: false } }], 'after')).toThrow();
        const state = (await db.query<{ json_build_object: string }>(accountClosureDisabledQuery)).rows[0].json_build_object;
        expect(assertAccountClosureTerminal([output, state], 'after').passed).toBe(true);
    });
});
