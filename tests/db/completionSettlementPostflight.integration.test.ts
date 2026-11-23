// Catalog oracle only for migration 129: exact migration bytes, no account data, settlement RPC or billing value.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    assertCompletionSettlementSnapshot, COMPLETION_SETTLEMENT_PREDECESSOR, COMPLETION_SETTLEMENT_VERSION,
    completionSettlementContract, completionSettlementLedger, completionSettlementSnapshotQuery,
} from '../../scripts/lib/completionSettlementMigrationPostflight.mjs';

const root = resolve(import.meta.dirname, '../..');
const target = COMPLETION_SETTLEMENT_VERSION;
let db: PGlite;
const read = async () => {
    const { rows } = await db.query<{ json_build_object: string }>(completionSettlementSnapshotQuery());
    expect(rows).toHaveLength(1);
    return JSON.parse(rows[0].json_build_object);
};
const contract = (mode: string) => completionSettlementContract(root, mode, target);
let verifiedBefore: { ledger: string[] } | null = null;
const refused = async (phase: 'before' | 'after', sql: string, refusal: RegExp) => {
    await db.exec('BEGIN');
    try {
        await db.exec(sql);
        const snapshot = await read();
        expect(() => assertCompletionSettlementSnapshot(contract(phase), snapshot, verifiedBefore)).toThrow(refusal);
    } finally {
        await db.exec('ROLLBACK');
    }
};

describe('migration 129 exact completion-settlement catalog postflight', () => {
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
            CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text);
            CREATE TABLE public.account_completion_configuration (singleton boolean, enabled boolean, scope_digest text);
            INSERT INTO public.account_completion_configuration VALUES (true, false, NULL);
            INSERT INTO supabase_migrations.schema_migrations VALUES ${COMPLETION_SETTLEMENT_PREDECESSOR.map(v => `('${v}')`).join(',')};`);
    }, 30_000);
    afterAll(async () => { await db?.close(); });

    it('129 sorts inside the reviewed ledger window, never appended', () => {
        const after = completionSettlementLedger(COMPLETION_SETTLEMENT_PREDECESSOR);
        expect(after).toHaveLength(COMPLETION_SETTLEMENT_PREDECESSOR.length + 1);
        expect(after.indexOf(target)).toBe(after.indexOf('20261025021046') + 1);
        expect(after.at(-1)).toBe('20261119200000');
        expect(() => completionSettlementContract(root, 'after', '20261119200000')).toThrow(/phase\/target invalid/);
        expect(() => completionSettlementContract(root, 'during', target)).toThrow(/phase\/target invalid/);
    });

    it('before: the exact production window, the family absent and completion OFF and unbound; drift is refused', async () => {
        const before = await read();
        expect(assertCompletionSettlementSnapshot(contract('before'), before)).toMatchObject({ target: 'absent', completion: 'off-unbound' });
        expect(() => assertCompletionSettlementSnapshot(contract('after'), before, before)).toThrow(/ledger/);
        expect(() => assertCompletionSettlementSnapshot(contract('after'), before)).toThrow(/requires the verified before ledger/);
        // Identity, not count: an unreviewed version, a missing required predecessor or an unordered ledger is refused.
        await refused('before', "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261119999999')", /unreviewed version/);
        await refused('before', "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261024083000'", /required predecessor is missing/);
        expect(() => assertCompletionSettlementSnapshot(contract('before'), { ...before, ledger: [...before.ledger].reverse() })).toThrow(/version-ordered/);
        await refused('before', 'UPDATE public.account_completion_configuration SET enabled = true', /OFF and unbound/);
        await refused('before', "UPDATE public.account_completion_configuration SET scope_digest = 'bound'", /OFF and unbound/);
        await refused('before', 'INSERT INTO public.account_completion_configuration VALUES (true, false, NULL)', /OFF and unbound/);
        await refused('before', "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261119200000'", /ledger/);
        await refused('before', "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261120000000')", /ledger/);
        verifiedBefore = before;
        await refused('before', "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261112130000')", /withheld/);
        await refused('before', `CREATE FUNCTION public.settle_account_completion_billing_v1(text) RETURNS boolean
            LANGUAGE sql AS $$ SELECT false $$`, /already present/);
    }, 30_000);

    it('after: exactly the one restricted function, the ledger with 129 in order, completion still OFF; drift is refused', async () => {
        await db.exec(readFileSync(resolve(root,
            'backend/supabase/migrations/20261027192550_account_completion_billing_settlement.sql'), 'utf8'));
        const unrecorded = await read();
        expect(() => assertCompletionSettlementSnapshot(contract('before'), unrecorded)).toThrow(/already present/);
        expect(() => assertCompletionSettlementSnapshot(contract('after'), unrecorded, verifiedBefore)).toThrow(/ledger/);
        await db.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', [target]);
        await db.exec('SET search_path=pg_catalog');
        const after = await read();
        expect(assertCompletionSettlementSnapshot(contract('after'), after, verifiedBefore)).toMatchObject({ target: 'exact', completion: 'off-unbound' });
        // The after ledger is the verified before ledger plus 129 only: any other change since the receipt is refused.
        expect(() => assertCompletionSettlementSnapshot(contract('after'), after, { ledger: verifiedBefore!.ledger.slice(1) })).toThrow(/ledger/);
        expect(() => assertCompletionSettlementSnapshot(contract('after'), after)).toThrow(/requires the verified before ledger/);
        expect(after.functions[0][14]).toEqual([false, false, true]); // EXECUTE: anon no, authenticated no, service_role yes

        const signature = 'public.settle_account_completion_billing_v1(uuid,uuid,uuid,text,jsonb)';
        await refused('after', `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated`, /function catalog/);
        await refused('after', `GRANT EXECUTE ON FUNCTION ${signature} TO anon`, /function catalog/);
        await refused('after', `GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC`, /function catalog/);
        await refused('after', `ALTER FUNCTION ${signature} RESET search_path`, /function catalog/);
        await refused('after', `ALTER FUNCTION ${signature} SECURITY INVOKER`, /function catalog/);
        await refused('after', `CREATE OR REPLACE FUNCTION ${signature.replace('(uuid,uuid,uuid,text,jsonb)',
            '(p_user_id uuid,p_request_id uuid,p_execution_id uuid,p_scope_digest text,p_subscriptions jsonb)')}
            RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN true; END $$`, /function catalog/);
        await refused('after', `CREATE FUNCTION public.settle_account_completion_billing_v1(text) RETURNS boolean
            LANGUAGE sql AS $$ SELECT false $$`, /function catalog/);
        await refused('after', 'UPDATE public.account_completion_configuration SET enabled = true', /OFF and unbound/);
        await refused('after', "UPDATE public.account_completion_configuration SET scope_digest = 'bound'", /OFF and unbound/);
        await refused('after', "INSERT INTO supabase_migrations.schema_migrations VALUES ('20261112130000')", /withheld/);
        await refused('after', "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261110173548'", /ledger/);
    }, 30_000);

    it('the migration itself refuses to install while completion is enabled or bound', async () => {
        const local = new PGlite();
        try {
            await local.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
                CREATE TABLE public.account_completion_configuration (singleton boolean, enabled boolean, scope_digest text);
                INSERT INTO public.account_completion_configuration VALUES (true, true, NULL);`);
            await expect(local.exec(readFileSync(resolve(root,
                'backend/supabase/migrations/20261027192550_account_completion_billing_settlement.sql'), 'utf8')))
                .rejects.toThrow(/completion must remain disabled before settlement apply/);
        } finally {
            await local.close();
        }
    }, 30_000);
});
