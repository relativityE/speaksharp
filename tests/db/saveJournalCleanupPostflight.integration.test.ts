// Catalog oracle only: exact migration bytes, no application account data or RPC calls.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    assertSaveJournalCleanupSnapshot, SAVE_JOURNAL_CLEANUP_VERSION,
    saveJournalCleanupContract, saveJournalCleanupSnapshotQuery,
} from '../../scripts/lib/saveJournalCleanupMigrationPostflight.mjs';

const root = resolve(import.meta.dirname, '../..');
const target = SAVE_JOURNAL_CLEANUP_VERSION;
const ledger = [
    '20261018090000', '20261018170000', '20261019010000', '20261019055102', '20261019202856', '20261020230653',
    '20261024083000', '20261025021046', '20261110173548', '20261112133000', '20261114100000',
    '20261114170000', '20261117105700', '20261119120000',
];
let db: PGlite;
const read = async () => {
    const { rows } = await db.query<{ json_build_object: string }>(saveJournalCleanupSnapshotQuery());
    expect(rows).toHaveLength(1);
    return JSON.parse(rows[0].json_build_object);
};
const contract = (mode: string) => saveJournalCleanupContract(root, mode, target);
const mutation = async (sql: string, refusal: RegExp) => {
    await db.exec('BEGIN');
    try {
        await db.exec(sql);
        const snapshot = await read();
        expect(() => assertSaveJournalCleanupSnapshot(contract('after'), snapshot)).toThrow(refusal);
    } finally {
        await db.exec('ROLLBACK');
    }
};

describe('#1906 exact cleanup catalog postflight', () => {
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
            CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text);
            CREATE TABLE public.account_save_obligations (user_id uuid);
            INSERT INTO supabase_migrations.schema_migrations VALUES ${ledger.map(v => `('${v}')`).join(',')};`);
    }, 30_000);
    afterAll(async () => { await db?.close(); });

    it('matches exact before/after ledgers and the installed source, and refuses real catalog drift', async () => {
        const before = await read();
        expect(assertSaveJournalCleanupSnapshot(contract('before'), before)).toMatchObject({ target: 'absent' });
        expect(() => assertSaveJournalCleanupSnapshot(contract('after'), before)).toThrow(/ledger/);

        await db.exec(readFileSync(resolve(root,
            'backend/supabase/migrations/20261119200000_deleted_account_save_journal_cleanup_1643.sql'), 'utf8'));
        const unrecorded = await read();
        expect(() => assertSaveJournalCleanupSnapshot(contract('before'), unrecorded)).toThrow(/already present/);
        await db.query('INSERT INTO supabase_migrations.schema_migrations VALUES ($1)', [target]);
        await db.exec('SET search_path=pg_catalog');
        const after = await read();
        expect(assertSaveJournalCleanupSnapshot(contract('after'), after)).toMatchObject({ target: 'exact' });

        await mutation('GRANT EXECUTE ON FUNCTION public.count_account_save_journal_v1(uuid) TO authenticated', /function catalog/);
        await mutation('CREATE FUNCTION public.count_account_save_journal_v1(text) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$', /function catalog/);
        await mutation('CREATE OR REPLACE FUNCTION public.count_account_save_journal_v1(p_user_id uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=\'\' AS $$ SELECT 0 $$', /function catalog/);
        await mutation('GRANT SELECT (user_id) ON public.account_save_journal_cleanup_claims TO service_role', /permissions/);
        await mutation('ALTER TABLE public.account_save_journal_cleanup_claims DISABLE ROW LEVEL SECURITY', /RLS/);
        await mutation('ALTER TABLE public.account_save_journal_cleanup_claims ALTER COLUMN claimed_at DROP NOT NULL', /columns/);
        await mutation("INSERT INTO supabase_migrations.schema_migrations VALUES ('20261112130000')", /withheld/);
        expect(after.major).toBe(18); // This fixture uses pinned PGlite; a separate native profile covers PG17.
        after.table.notNullConstraints[1][1] = false;
        expect(() => assertSaveJournalCleanupSnapshot(contract('after'), after)).toThrow(/not-null constraints/);
    }, 30_000);
});
