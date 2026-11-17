// @vitest-environment node
// #1884 (Sam, 17 Nov): why the J4.a parent teardown must HOLD before any destructive step unless it has a reviewed, run-bound way to
// settle, remove and independently read back account_save_obligations rows. Executed against the REAL migration chain (PGlite, a
// disposable in-process database; no hosted effects), with Supabase's default API-role table grants emulated BEFORE the chain so the
// migrations' own REVOKEs decide access:
//   1. a Start admits a save obligation; while it is unsettled, the Auth delete is refused by _account_save_delete_guard_v1;
//   2. once that exact row is completed, the Auth delete succeeds and the journal row SURVIVES it (no Auth FK, no cascade), so a
//      successful Auth delete is not proof the journal is clean;
//   3. service_role cannot read the journal at all (the migration revokes it), so a service-role zero-residue read of it can never
//      be an observed zero. CONTROL: service_role can read an ordinary granted table, so the refusal is the journal's own.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'backend/supabase/migrations');
const CONTRACT = readFileSync(resolve(process.cwd(), 'tests/db/trial-read-access-current-chain.integration.test.ts'), 'utf8');
const BOOTSTRAP = CONTRACT.split('const BOOTSTRAP = `')[1].split('`;')[0];

describe('#1884 J4.a save journal vs Auth deletion (real migration chain)', () => {
    let db: PGlite;
    let migrations = 0;
    beforeAll(async () => {
        db = new PGlite();
        await db.exec(BOOTSTRAP);
        // Supabase's default privileges for API roles on new public tables (the chain's REVOKEs then narrow them), and its
        // service_role bypasses row-level security, so table privileges alone decide what it can read.
        await db.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role; ALTER ROLE service_role BYPASSRLS;');
        for (const file of readdirSync(DIR).filter((f) => /^\d{8,14}_.+\.sql$/.test(f)).sort()) {
            await db.exec(readFileSync(resolve(DIR, file), 'utf8'));
            migrations += 1;
        }
        await db.exec('ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz');
    }, 180_000);
    afterAll(async () => { await db?.close(); });

    async function asRole<T>(role: 'authenticated' | 'service_role', uid: string | null, work: () => Promise<T>): Promise<T> {
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid ?? '']);
        await db.query("SELECT set_config('request.jwt.claim.role',$1,false)", [role]);
        await db.exec(`SET ROLE ${role}`);
        try { return await work(); } finally { await db.exec('RESET ROLE'); }
    }
    const journal = async (uid: string) => (await db.query<{ lease_id: string; phase: string }>(
        'SELECT lease_id, phase FROM public.account_save_obligations WHERE user_id=$1 ORDER BY lease_id', [uid])).rows;
    const deleteAuth = async (uid: string) => {
        try { await db.query('DELETE FROM auth.users WHERE id=$1', [uid]); return 'deleted'; } catch (e) { return (e as Error).message; }
    };
    /** A run-owned-style account that pressed Start once: a lease and the take's row, so the journal admits one save. */
    async function startedTake() {
        const uid = randomUUID();
        await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [uid, `rwt-journey-j4-unit-${uid.slice(0, 8)}@example.test`]);
        const lease = randomUUID();
        await asRole('authenticated', uid, async () => {
            await db.query("SELECT public.acquire_recording_lease($1::uuid,'j4a-journal-proof',false)", [lease]);
            await db.query("SELECT public.create_session_and_update_usage($1::jsonb,'private')",
                [JSON.stringify({ title: 'synthetic j4a journal proof', duration: 0, total_words: 0, lease_id: lease })]);
        });
        return { uid, lease };
    }

    it('the whole chain ran', () => { expect(migrations).toBeGreaterThan(100); });

    it('an unsettled admitted save refuses the Auth delete; the account and the journal row remain', async () => {
        const { uid, lease } = await startedTake();
        expect(await journal(uid)).toEqual([{ lease_id: lease, phase: 'admitted' }]);
        expect(await deleteAuth(uid)).toMatch(/account admitted save unsettled/);
        expect((await db.query('SELECT 1 FROM auth.users WHERE id=$1', [uid])).rows).toHaveLength(1);
        expect(await journal(uid)).toEqual([{ lease_id: lease, phase: 'admitted' }]);
    });

    it('once that exact row is completed, the Auth delete succeeds and the completed journal row SURVIVES it', async () => {
        const { uid, lease } = await startedTake();
        await db.query("UPDATE public.account_save_obligations SET phase='completed' WHERE user_id=$1 AND lease_id=$2", [uid, lease]);
        expect(await deleteAuth(uid)).toBe('deleted');
        expect((await db.query('SELECT 1 FROM auth.users WHERE id=$1', [uid])).rows).toHaveLength(0);
        expect(await journal(uid)).toEqual([{ lease_id: lease, phase: 'completed' }]);
    });

    it('service_role cannot read the journal (permission denied); CONTROL: it can read an ordinary granted table', async () => {
        const { uid } = await startedTake();
        await expect(asRole('service_role', null, () => db.query('SELECT count(*) FROM public.account_save_obligations WHERE user_id=$1', [uid])))
            .rejects.toThrow(/permission denied/);
        const control = await asRole('service_role', null, () => db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.user_profiles WHERE id=$1', [uid]));
        expect(control.rows[0].n).toBe(1);
    });
});
