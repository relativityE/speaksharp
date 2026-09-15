// @vitest-environment node
//
// #1473 — the contingent `user_profiles` SELECT grant restores own-row profile reads, and nothing more.
//
// Real PostgreSQL (PGlite). Roles, `auth.uid()` from the JWT claim GUC and the `authenticated` / `anon` roles come
// from the shared bootstrap. The row-level policy is NOT restated here: it is extracted verbatim from the committed
// migration that owns it (20260522090000), so this suite exercises the policy Production actually carries.
// The out-of-band loss is modelled by `authenticated` holding no table privilege, which is how the
// 42501 "permission denied for table user_profiles" arose. Content-free: synthetic UUIDs only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const bootstrapSql = readFileSync(resolve(process.cwd(), 'tests', 'db', 'attribution-authority-bootstrap.sql'), 'utf8');
const POLICY_MIGRATION = '20260522090000_harden_runtime_billing_invariants.sql';
const GRANT_MIGRATION = '20260915160000_user_profiles_select_grant_1473.sql';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/** The committed own-profile SELECT policy, extracted exactly as written. */
function committedProfilePolicy(): string {
    const match = /CREATE POLICY "Users can select own profile"[\s\S]*?;/.exec(MIG(POLICY_MIGRATION));
    if (!match) throw new Error(`own-profile policy not found in ${POLICY_MIGRATION}`);
    return match[0];
}

async function makeDb({ withGrant }: { withGrant: boolean }): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(bootstrapSql);
    // The columns the product reads; the shape of the policy's `id` predicate is what matters here.
    await db.exec(`CREATE TABLE public.user_profiles (
        id uuid PRIMARY KEY REFERENCES auth.users(id),
        subscription_status text DEFAULT 'basic'
    );`);
    await db.exec(`ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;`);
    await db.exec(committedProfilePolicy());
    await db.query(`INSERT INTO auth.users (id) VALUES ($1), ($2)`, [USER, OTHER]);
    await db.query(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ($1, 'pro'), ($2, 'free')`, [USER, OTHER]);
    if (withGrant) await db.exec(MIG(GRANT_MIGRATION));
    return db;
}

/** Run `sql` as a signed-in user, the way PostgREST does: role `authenticated`, `auth.uid()` from the claim. */
async function asUser<T>(db: PGlite, uid: string, sql: string, params: unknown[] = []) {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await db.exec(`SET ROLE authenticated`);
    try {
        return await db.query<T>(sql, params);
    } finally {
        await db.exec(`RESET ROLE`);
    }
}

describe('#1473 — user_profiles SELECT grant (contingent repair)', () => {
    it('PRECONDITION (RED): without the table privilege, a signed-in user\'s own profile read fails with 42501', async () => {
        const db = await makeDb({ withGrant: false });
        await expect(asUser(db, USER, `SELECT id FROM public.user_profiles`)).rejects.toThrow(/permission denied/i);
    });

    it('CASUALTY: with the grant, a signed-in user reads exactly their own profile row', async () => {
        const db = await makeDb({ withGrant: true });
        const rows = (await asUser<{ id: string; subscription_status: string }>(db, USER,
            `SELECT id, subscription_status FROM public.user_profiles`)).rows;
        expect(rows).toEqual([{ id: USER, subscription_status: 'pro' }]);
    });

    it('CASUALTY: with the grant, another user\'s profile stays invisible (RLS still decides the rows)', async () => {
        const db = await makeDb({ withGrant: true });
        const other = (await asUser<{ id: string }>(db, USER, `SELECT id FROM public.user_profiles WHERE id = $1`, [OTHER])).rows;
        expect(other).toEqual([]);
        const theirOwn = (await asUser<{ id: string }>(db, OTHER, `SELECT id FROM public.user_profiles`)).rows;
        expect(theirOwn).toEqual([{ id: OTHER }]);
    });

    it('CONTROL: the grant is SELECT only — a signed-in user still cannot insert, update or delete profiles', async () => {
        const db = await makeDb({ withGrant: true });
        await expect(asUser(db, USER, `UPDATE public.user_profiles SET subscription_status = 'pro' WHERE id = $1`, [USER]))
            .rejects.toThrow(/permission denied/i);
        await expect(asUser(db, USER, `DELETE FROM public.user_profiles WHERE id = $1`, [USER]))
            .rejects.toThrow(/permission denied/i);
        await expect(asUser(db, USER, `INSERT INTO public.user_profiles (id) VALUES ($1)`, [USER]))
            .rejects.toThrow(/permission denied/i);
    });

    it('CONTROL: anon gains nothing', async () => {
        const db = await makeDb({ withGrant: true });
        await db.exec(`SET ROLE anon`);
        try {
            await expect(db.query(`SELECT id FROM public.user_profiles`)).rejects.toThrow(/permission denied/i);
        } finally {
            await db.exec(`RESET ROLE`);
        }
    });

    it('CONTROL: the migration is exactly one SELECT grant to authenticated — no policy, role or other privilege change', () => {
        const statements = MIG(GRANT_MIGRATION)
            .split('\n').filter((line) => !/^\s*--/.test(line)).join('\n')
            .split(';').map((s) => s.trim()).filter(Boolean);
        expect(statements).toEqual(['GRANT SELECT ON public.user_profiles TO authenticated']);
    });
});
