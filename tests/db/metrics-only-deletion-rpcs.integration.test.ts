// @vitest-environment node
//
// #1306 deletion closure — EXECUTED proof of the content-free, idempotent, owner-scoped deletion RPCs:
//   delete_my_session(uuid) and delete_my_account(). Ownership is enforced in-function (SECURITY DEFINER
// bypasses RLS); results are counts/booleans only; double-deletes are no-op successes; and account purge
// clears every user_id-scoped table (cascade-safe) without touching another user's rows.
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DELETION = readFileSync(
  resolve(process.cwd(), 'backend', 'supabase', 'migrations', '20260817120000_metrics_only_deletion_rpcs_1306.sql'),
  'utf8',
);
const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let seq = 0;
const sid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;

// A minimal schema with two user_id-scoped tables + a profile, and auth.uid() switchable per test.
const bootstrap = (uid: string) => `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT ${uid === 'NULL' ? 'NULL::uuid' : `'${uid}'::uuid`} $fn$;
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  END $r$;
`;

async function freshDb(uid: string = U): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.sessions (id uuid PRIMARY KEY, user_id uuid, status text);
    CREATE TABLE public.user_filler_words (id uuid PRIMARY KEY, user_id uuid, word text);
    CREATE TABLE public.user_profiles (id uuid PRIMARY KEY, subscription_status text);
  `);
  await db.exec(bootstrap(uid));
  await db.exec(DELETION);
  return db;
}

const seedUser = async (db: PGlite, uid: string) => {
  await db.query(`INSERT INTO public.sessions (id, user_id, status) VALUES ($1,$2,'completed')`, [sid(), uid]);
  await db.query(`INSERT INTO public.user_filler_words (id, user_id, word) VALUES ($1,$2,'gonna')`, [sid(), uid]);
  await db.query(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ($1,'pro') ON CONFLICT DO NOTHING`, [uid]);
};

let db: PGlite;
beforeEach(async () => { db = await freshDb(U); });

describe('#1306 delete_my_session — idempotent, owner-scoped, content-free', () => {
  it('deletes the caller\'s own session and reports deleted=true', async () => {
    const s = sid();
    await db.query(`INSERT INTO public.sessions (id, user_id, status) VALUES ($1,$2,'completed')`, [s, U]);
    const r = (await db.query<{ r: { deleted: boolean } }>(`SELECT public.delete_my_session($1) AS r`, [s])).rows[0].r;
    expect(r.deleted).toBe(true);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.sessions WHERE id=$1`, [s])).rows[0].n).toBe(0);
  });

  it('is idempotent: a second delete (or a missing id) is a no-op success (deleted=false)', async () => {
    const s = sid();
    await db.query(`INSERT INTO public.sessions (id, user_id, status) VALUES ($1,$2,'completed')`, [s, U]);
    await db.query(`SELECT public.delete_my_session($1)`, [s]);
    const again = (await db.query<{ r: { deleted: boolean } }>(`SELECT public.delete_my_session($1) AS r`, [s])).rows[0].r;
    expect(again.deleted).toBe(false);
    const missing = (await db.query<{ r: { deleted: boolean } }>(`SELECT public.delete_my_session($1) AS r`, [sid()])).rows[0].r;
    expect(missing.deleted).toBe(false);
  });

  it('cannot delete ANOTHER user\'s session (no-op, their row survives)', async () => {
    const s = sid();
    await db.query(`INSERT INTO public.sessions (id, user_id, status) VALUES ($1,$2,'completed')`, [s, OTHER]);
    const r = (await db.query<{ r: { deleted: boolean } }>(`SELECT public.delete_my_session($1) AS r`, [s])).rows[0].r;
    expect(r.deleted).toBe(false);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.sessions WHERE id=$1`, [s])).rows[0].n).toBe(1);
  });

  it('rejects an unauthenticated caller', async () => {
    const anon = await freshDb('NULL');
    await expect(anon.query(`SELECT public.delete_my_session($1)`, [sid()])).rejects.toThrow(/Unauthorized/i);
  });
});

describe('#1306 delete_my_account — purges every owned table, cascade-safe, content-free', () => {
  it('deletes ALL of the caller\'s rows across user_id tables + the profile, leaving other users intact', async () => {
    await seedUser(db, U);
    await seedUser(db, OTHER);
    const r = (await db.query<{ r: { ok: boolean; rows_deleted: number } }>(`SELECT public.delete_my_account() AS r`)).rows[0].r;
    expect(r.ok).toBe(true);
    expect(r.rows_deleted).toBeGreaterThanOrEqual(3); // 1 session + 1 filler word + 1 profile
    // The caller is fully purged...
    for (const tbl of ['sessions', 'user_filler_words']) {
      expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${tbl} WHERE user_id=$1`, [U])).rows[0].n).toBe(0);
    }
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.user_profiles WHERE id=$1`, [U])).rows[0].n).toBe(0);
    // ...and the OTHER user is completely untouched.
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.sessions WHERE user_id=$1`, [OTHER])).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.user_profiles WHERE id=$1`, [OTHER])).rows[0].n).toBe(1);
  });

  it('is idempotent: purging an already-empty account is a no-op success', async () => {
    const r = (await db.query<{ r: { ok: boolean; rows_deleted: number } }>(`SELECT public.delete_my_account() AS r`)).rows[0].r;
    expect(r.ok).toBe(true);
    expect(r.rows_deleted).toBe(0);
  });

  it('rejects an unauthenticated caller', async () => {
    const anon = await freshDb('NULL');
    await expect(anon.query(`SELECT public.delete_my_account()`)).rejects.toThrow(/Unauthorized/i);
  });
});

describe('#1306 deletion RPC authorization (ACL)', () => {
  it('EXECUTE is granted to authenticated and revoked from PUBLIC/anon', async () => {
    for (const fn of ['delete_my_session', 'delete_my_account']) {
      const acl = await db.query<{ grantee: string }>(
        `SELECT grantee FROM information_schema.role_routine_grants
         WHERE routine_name = $1 AND privilege_type = 'EXECUTE'`, [fn],
      );
      const grantees = acl.rows.map(r => r.grantee);
      expect(grantees).toContain('authenticated');
      expect(grantees).not.toContain('anon');
      expect(grantees).not.toContain('PUBLIC');
    }
  });
});
