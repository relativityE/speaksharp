// @vitest-environment node
//
// #1258 P0 — A RETURNING USER'S SECOND SAVE, WITH THE FUNCTIONS OWNED THE WAY PRODUCTION OWNS THEM.
//
// Production's second and later saves failed with 42501 `permission denied to set parameter
// "session_replication_role"`: the retention expiry reached from complete_session_v2 set a superuser-only
// parameter, and Supabase's function owner (`postgres`) is not a superuser. Every other retention suite runs
// its SECURITY DEFINER functions as the PGlite superuser, where that SET is allowed — which is exactly why
// none of them caught it.
//
// So this suite hands every table and function to a NOSUPERUSER owner after the real migrations run, and
// drives the save as `authenticated`. Against 20260908120000 alone the second save fails with Production's
// exact error; with 20261013120000 it saves, expires the older text into its tombstone, and purges that
// row's derived suggestions — with the #1476 fence, the #1258 product guard and the purge trigger all live,
// since the `replica` setting used to silence every one of them. The casualties prove the exemption the fix
// adds to the derivation trigger cannot be reached by a client, by a nested SECURITY DEFINER write as the
// owner, or by the owner without both this transaction's grant and the tombstone.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const M = (f: string) => readFileSync(resolve(DIR, f), 'utf8');
const CHAIN = [
    '20260801000000_sessions_transcript_state.sql',
    '20260803000000_transcript_retention_newest_two.sql',
    '20260731120000_session_progress_evaluations.sql',
    '20260804000000_transcript_retention_converge_on_save.sql',
    '20260805000000_transcript_retention_preflight.sql',
    '20260810120000_retention_purge_ai_suggestions.sql',
    '20260819120000_complete_session_v2_atomic_retention_1314.sql',
    '20260908120000_transcript_retention_newest_one.sql',
    // Every other trigger on `sessions` the `replica` setting used to silence, so the expiry UPDATE meets them all.
    '20260607040000_active_recording_lease.sql',
    '20260923120000_one_active_engine_per_account_1476.sql',
    '20260926190000_session_product_marker_1258.sql',
].map(M);
const FIX_FILE = '20261013120000_retention_expiry_without_superuser_1258.sql';
const FIX = M(FIX_FILE);

const U = '11111111-1111-4111-8111-111111111111';
const OWNER = 'ss_function_owner';
const LEASE = 'aaaaaaaa-0000-4000-8000-000000000001';

/** The writer-atomicity bootstrap, plus the `ai_suggestions` column the purge trigger reads. */
const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  END $r$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  INSERT INTO auth.users (id) VALUES ('${U}');
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT '${U}'::uuid $fn$;
  CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY, subscription_status text, trial_expires_at timestamptz,
    stripe_subscription_id text, subscription_id text, commercial_trial_granted_at timestamptz,
    trial_started_at timestamptz, updated_at timestamptz);
  INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${U}', 'pro');
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  CREATE TABLE public.tier_configs (tier_name text PRIMARY KEY, max_concurrent_sessions int);
  INSERT INTO public.tier_configs VALUES ('pro', 50), ('free', 1);
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz,
    title text, transcript text,
    total_words int, duration int, filler_counts jsonb, filler_words jsonb,
    accuracy double precision, ground_truth text, engine text,
    idempotency_key uuid, engine_version text, model_name text, device_type text,
    expires_at timestamptz,
    status text, next_action_signal jsonb, status_reason text,
    clarity_score double precision, wpm double precision, pause_metrics jsonb,
    ai_suggestions jsonb
  );
  CREATE TABLE public.usage_checkpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid, user_id uuid, incremental_seconds int, engine_type text,
    created_at timestamptz DEFAULT now());
  CREATE OR REPLACE FUNCTION public.update_user_usage(int, text, uuid)
    RETURNS jsonb LANGUAGE sql AS $fn$ SELECT jsonb_build_object('success', true) $fn$;
`;

/**
 * Production's ownership: everything the migrations created belongs to a role that is NOT a superuser, so
 * every SECURITY DEFINER function runs without superuser rights. `authenticated` gets the direct row access
 * Production grants it on `sessions` (the client UPDATE path the derivation trigger exists to police).
 */
const PRODUCTION_OWNERSHIP = `
  CREATE ROLE ${OWNER} NOSUPERUSER NOCREATEROLE NOCREATEDB;
  GRANT USAGE, CREATE ON SCHEMA public TO ${OWNER};
  GRANT USAGE ON SCHEMA auth TO ${OWNER};
  GRANT USAGE ON SCHEMA public TO authenticated, service_role;
  DO $o$ DECLARE r record; BEGIN
    FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname IN ('public', 'auth') AND c.relkind = 'r' LOOP
      EXECUTE format('ALTER TABLE %I.%I OWNER TO ${OWNER}', r.nspname, r.relname);
    END LOOP;
    FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.prokind = 'f' LOOP
      EXECUTE format('ALTER FUNCTION %s OWNER TO ${OWNER}', r.sig);
    END LOOP;
  END $o$;
  GRANT SELECT, UPDATE ON public.sessions TO authenticated;
`;

async function freshDb(withFix: boolean): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    for (const sql of CHAIN) await db.exec(sql);
    if (withFix) await db.exec(FIX);
    await db.query('SELECT public.activate_transcript_retention_newest_one()');
    await db.exec(PRODUCTION_OWNERSHIP);
    return db;
}

/** Run `fn` as `role`, always returning to the bootstrap superuser for fixtures and readbacks. */
async function asRole<T>(db: PGlite, role: string, fn: () => Promise<T>): Promise<T> {
    await db.exec(`SET ROLE ${role}`);
    try { return await fn(); } finally { await db.exec('RESET ROLE'); }
}

/** A take recording under the account's live lease, as the #1476 fence requires of every active row. */
async function activeTake(db: PGlite, createdAt: string): Promise<string> {
    await asRole(db, 'authenticated', () => db.query(`SELECT public.acquire_recording_lease($1::uuid, 'device', false)`, [LEASE]));
    return (await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, created_at, total_words, duration, status, lease_id)
         VALUES ($1, $2::timestamptz, 100, 600, 'active', $3) RETURNING id`, [U, createdAt, LEASE])).rows[0].id;
}

/** The client's save, exactly as PostgREST runs it: `authenticated`, through the RPC. */
const save = (db: PGlite, id: string, words: string) => asRole(db, 'authenticated', () => db.query<{ r: Record<string, unknown> }>(
    `SELECT public.complete_session_v2(p_session_id => $1::uuid, p_status => 'completed',
         p_next_action => '{"kind":"practice_again"}'::jsonb, p_filler_counts => '{}'::jsonb,
         p_final_transcript => $2) AS r`, [id, words]));

async function settle(db: PGlite, sessionId: string, status: 'attributed' | 'pending') {
    await db.query(
        `INSERT INTO public.session_progress_evaluations
           (session_id, user_id, formula_version, attribution_status,
            duration_seconds, word_count, clarity_evidence_available, eligible, exclusion_reasons)
         VALUES ($1, $2, 'clarity_v1', $3, 600, 100, true, false, ARRAY['unverified_attribution'])`,
        [sessionId, U, status]);
}

type Row = { transcript_state: string; transcript: string | null; ai_suggestions: unknown };
const row = async (db: PGlite, id: string) => (await db.query<Row>(
    'SELECT transcript_state, transcript, ai_suggestions FROM public.sessions WHERE id = $1', [id])).rows[0];

/** A first save that armed retention, its evaluation settled, with derived suggestions on the row. */
async function firstSaveSettled(db: PGlite): Promise<string> {
    const first = await activeTake(db, '2026-10-01T10:00:00Z');
    expect((await save(db, first, 'the first take')).rows[0].r.transcript_outcome).toBe('retained');
    await db.query(`UPDATE public.sessions SET ai_suggestions = '["a takeaway"]'::jsonb WHERE id = $1`, [first]);
    await settle(db, first, 'attributed');
    return first;
}

describe('#1258 P0 — retention expiry runs without superuser rights', () => {
    it('the harness reproduces Production: the owner is not a superuser, and the shipped expiry fails the second save with 42501', async () => {
        const db = await freshDb(false);
        expect((await db.query<{ su: boolean }>(`SELECT rolsuper AS su FROM pg_roles WHERE rolname = '${OWNER}'`)).rows[0].su).toBe(false);
        const first = await firstSaveSettled(db);
        const second = await activeTake(db, '2026-10-02T10:00:00Z');

        await expect(save(db, second, 'the second take'))
            .rejects.toThrow(/permission denied to set parameter "session_replication_role"/);
        // The whole completion rolled back: the take is still unsaved and the older text is untouched.
        expect((await db.query<{ status: string }>('SELECT status FROM public.sessions WHERE id = $1', [second])).rows[0].status).toBe('active');
        expect((await row(db, first)).transcript).toBe('the first take');
        await db.close();
    });

    it('with the fix the second save succeeds, the older text is expired into its tombstone, and its suggestions go with it', async () => {
        const db = await freshDb(true);
        const first = await firstSaveSettled(db);
        const second = await activeTake(db, '2026-10-02T10:00:00Z');

        const saved = (await save(db, second, 'the second take')).rows[0].r;
        expect(saved.transcript_outcome, 'the words the user just spoke are kept').toBe('retained');

        expect(await row(db, second)).toEqual({ transcript_state: 'available', transcript: 'the second take', ai_suggestions: null });
        expect(await row(db, first), 'expired, text gone, and the 20260810120000 purge now fires').toEqual(
            { transcript_state: 'expired', transcript: null, ai_suggestions: null });
        expect((await db.query<{ transcript: string }>(
            'SELECT transcript FROM public.transcript_retention_tombstones WHERE session_id = $1', [first])).rows,
        'the expired text is preserved, service-only').toEqual([{ transcript: 'the first take' }]);

        // A third save expires the second the same way: this is every later save, not one lucky one.
        await settle(db, second, 'attributed');
        const third = await activeTake(db, '2026-10-03T10:00:00Z');
        expect((await save(db, third, 'the third take')).rows[0].r.transcript_outcome).toBe('retained');
        expect((await row(db, second)).transcript_state).toBe('expired');
        await db.close();
    });

    it('the evaluation door: an evaluation that lands after the next save now expires the older text', async () => {
        // trg_spe_converge_retention reaches the same mutation when the older take's evaluation lands after the
        // next save. It swallows every convergence error so the evaluation is never lost — which, under the
        // shipped expiry, meant the 42501 silently left the older transcript readable.
        for (const withFix of [false, true]) {
            const db = await freshDb(withFix);
            const first = await activeTake(db, '2026-10-01T10:00:00Z');
            await save(db, first, 'the first take');
            const second = await activeTake(db, '2026-10-02T10:00:00Z');
            expect((await save(db, second, 'the second take')).rows[0].r.transcript_outcome).toBe('retained');
            expect((await row(db, first)).transcript_state, 'deferred: no settled evidence yet').toBe('available');

            await settle(db, first, 'attributed');
            // Shipped: silently not expired. Fixed: expired.
            expect({ withFix, state: (await row(db, first)).transcript_state })
                .toEqual({ withFix, state: withFix ? 'expired' : 'available' });
            await db.close();
        }
    });

    it('a first save expires nothing, and its row is the retained one', async () => {
        const db = await freshDb(true);
        const first = await firstSaveSettled(db);
        expect((await row(db, first)).transcript_state).toBe('available');
        expect((await db.query('SELECT 1 FROM public.transcript_retention_tombstones')).rows).toEqual([]);
        await db.close();
    });

    it('pending evidence defers the expiry and the save stands — before the fix as well as after', async () => {
        for (const withFix of [false, true]) {
            const db = await freshDb(withFix);
            const first = await activeTake(db, '2026-10-01T10:00:00Z');
            await save(db, first, 'the first take');
            await settle(db, first, 'pending');
            const second = await activeTake(db, '2026-10-02T10:00:00Z');
            expect((await save(db, second, 'the second take')).rows[0].r.transcript_outcome).toBe('retained');
            expect((await row(db, first)).transcript, `withFix=${withFix}: nothing expired on pending evidence`).toBe('the first take');
            await db.close();
        }
    });

    it('a tombstone contradiction is still refused as designed (23514), never as a privilege error, and changes nothing', async () => {
        const db = await freshDb(true);
        const first = await firstSaveSettled(db);
        await db.query(
            `INSERT INTO public.transcript_retention_tombstones (session_id, user_id, transcript, policy_version)
             VALUES ($1, $2, 'different text', public.transcript_retention_policy_version())`, [first, U]);
        const second = await activeTake(db, '2026-10-02T10:00:00Z');
        await expect(save(db, second, 'the second take')).rejects.toThrow(/tombstone contradiction in scope/);
        expect((await row(db, first)).transcript).toBe('the first take');
        expect((await db.query<{ status: string }>('SELECT status FROM public.sessions WHERE id = $1', [second])).rows[0].status).toBe('active');
        await db.close();
    });

    it('rollback: an expiry inside a transaction that rolls back leaves no expiry, tombstone or grant behind', async () => {
        const db = await freshDb(true);
        const first = await firstSaveSettled(db);
        const second = await activeTake(db, '2026-10-02T10:00:00Z');
        await db.exec('BEGIN');
        await save(db, second, 'the second take');
        expect((await row(db, first)).transcript_state, 'expired inside the transaction').toBe('expired');
        await db.exec('ROLLBACK');
        expect((await row(db, first)).transcript).toBe('the first take');
        expect((await db.query('SELECT 1 FROM public.transcript_retention_tombstones')).rows).toEqual([]);
        expect((await db.query('SELECT 1 FROM public.transcript_retention_expiry_grants')).rows).toEqual([]);
        await db.close();
    });

    it('the grants authorize only their own statement: none remain once the save returns, even in the same transaction', async () => {
        const db = await freshDb(true);
        await firstSaveSettled(db);
        const second = await activeTake(db, '2026-10-02T10:00:00Z');
        await db.exec('BEGIN');
        await save(db, second, 'the second take');
        expect((await db.query('SELECT 1 FROM public.transcript_retention_expiry_grants')).rows).toEqual([]);
        await db.exec('COMMIT');
        await db.close();
    });
});

/** A row whose exact text is already tombstoned, which is the most a forger could have to work with. */
async function tombstonedRow(db: PGlite): Promise<string> {
    const id = await activeTake(db, '2026-10-01T10:00:00Z');
    await save(db, id, 'the first take');
    await db.query(
        `INSERT INTO public.transcript_retention_tombstones (session_id, user_id, transcript, policy_version)
         VALUES ($1, $2, 'the first take', public.transcript_retention_policy_version())`, [id, U]);
    return id;
}
const FORGE = `UPDATE public.sessions SET transcript = NULL, transcript_state = 'expired' WHERE id = $1`;

describe('#1258 P0 — the exemption cannot be reached by anyone else', () => {
    it('CASUALTY: a client cannot assert `expired` on a tombstoned row, and cannot write a grant', async () => {
        const db = await freshDb(true);
        const id = await tombstonedRow(db);
        await asRole(db, 'authenticated', () => db.query(FORGE, [id]));
        expect((await row(db, id)).transcript_state, 'derived, never asserted').toBe('not_captured');
        await expect(asRole(db, 'authenticated', () => db.query(
            `INSERT INTO public.transcript_retention_expiry_grants VALUES (txid_current(), $1)`, [id])))
            .rejects.toThrow(/permission denied/);
        await db.close();
    });

    it('CASUALTY: a nested SECURITY DEFINER write as the owner, called by a client, still cannot assert `expired`', async () => {
        // The case a custom setting could not close: a definer function owned by the expiry's owner, which a
        // client can call, writing the forged state while a tombstone exists. No grant names its transaction.
        const db = await freshDb(true);
        const id = await tombstonedRow(db);
        await db.exec(`
          CREATE FUNCTION public.test_nested_forge(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER
            SET search_path = public, pg_temp AS $f$ ${FORGE.replace('$1', 'p')} $f$;
          ALTER FUNCTION public.test_nested_forge(uuid) OWNER TO ${OWNER};
          GRANT EXECUTE ON FUNCTION public.test_nested_forge(uuid) TO authenticated;`);
        await asRole(db, 'authenticated', () => db.query('SELECT public.test_nested_forge($1)', [id]));
        expect((await row(db, id)).transcript_state).toBe('not_captured');
        await db.close();
    });

    it('CASUALTY: a grant for this transaction is not enough without the tombstone, nor a tombstone with a stale grant', async () => {
        const db = await freshDb(true);
        const untombstoned = await activeTake(db, '2026-10-01T10:00:00Z');
        await save(db, untombstoned, 'the first take');
        await db.exec('BEGIN');
        await db.query('INSERT INTO public.transcript_retention_expiry_grants VALUES (txid_current(), $1)', [untombstoned]);
        await asRole(db, OWNER, () => db.query(FORGE, [untombstoned]));
        await db.exec('COMMIT');
        expect((await row(db, untombstoned)).transcript_state, 'grant, no tombstone').toBe('not_captured');

        const id = await tombstonedRow(db);
        await db.query('INSERT INTO public.transcript_retention_expiry_grants VALUES (txid_current(), $1)', [id]);
        await asRole(db, OWNER, () => db.query(FORGE, [id]));
        expect((await row(db, id)).transcript_state, 'tombstone, grant from another transaction').toBe('not_captured');
        await db.close();
    });

    it('CASUALTY: an ordinary client edit is untouched by the exemption and needs no access to the service-only tables', async () => {
        const db = await freshDb(true);
        const first = await activeTake(db, '2026-10-01T10:00:00Z');
        await save(db, first, 'the first take');
        await asRole(db, 'authenticated', () => db.query(
            `UPDATE public.sessions SET transcript = 'an edited take', transcript_state = 'expired' WHERE id = $1`, [first]));
        expect((await row(db, first)).transcript_state).toBe('available');
        await db.close();
    });

    it('CASUALTY: an expired row stays expired and textless when re-saved (sticky, unchanged)', async () => {
        const db = await freshDb(true);
        const first = await firstSaveSettled(db);
        await save(db, await activeTake(db, '2026-10-02T10:00:00Z'), 'the second take');
        await asRole(db, 'authenticated', () => db.query(
            `UPDATE public.sessions SET transcript = 'resurrected', transcript_state = 'available' WHERE id = $1`, [first]));
        expect(await row(db, first)).toEqual({ transcript_state: 'expired', transcript: null, ai_suggestions: null });
        await db.close();
    });
});

/**
 * Function identity for the read-only Production pre/postflight (scripts/postflight-gate-20261013120000.sh). Derived
 * here and on a PostgreSQL 17.10 server (identical): `before` is the reviewed live pair (20260908120000 expiry,
 * 20260801000000 derivation trigger), `after` is this fix. The pre-apply gate refuses to replace any other body.
 */
const EXPIRE_BEFORE_MD5 = 'b69060cd8e903e4f51870034557be1e8';
const TRIGGER_BEFORE_MD5 = '794bf7c4e293ed215152d56d706a44a7';
const EXPIRE_AFTER_MD5 = 'da188c4dcd5f3faa8fc8a20db8d674c9';
const TRIGGER_AFTER_MD5 = '400700738ca78de10d259b550499b5ac';
const DIGESTS = `SELECT md5(pg_get_functiondef('public.expire_transcripts_newest_one(uuid, integer)'::regprocedure)) AS expire,
                        md5(pg_get_functiondef('public.sessions_set_transcript_state()'::regprocedure)) AS trigger`;

describe('#1258 P0 — function identity pinned for the Production gate', () => {
    it('before: the reviewed live bodies; after: exactly this fix', async () => {
        const before = await freshDb(false);
        expect((await before.query(DIGESTS)).rows[0]).toEqual({ expire: EXPIRE_BEFORE_MD5, trigger: TRIGGER_BEFORE_MD5 });
        await before.close();
        const after = await freshDb(true);
        expect((await after.query(DIGESTS)).rows[0]).toEqual({ expire: EXPIRE_AFTER_MD5, trigger: TRIGGER_AFTER_MD5 });
        await after.close();
    });
});

describe('#1258 P0 — structure', () => {
    const body = FIX.slice(FIX.indexOf('CREATE OR REPLACE FUNCTION public.expire_transcripts_newest_one'));
    const code = (sql: string) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

    it('the fix sets no parameter at all, and its guards still precede the grant', () => {
        expect(code(FIX)).not.toMatch(/session_replication_role|set_config|SET LOCAL/i);
        const grant = body.indexOf('INSERT INTO public.transcript_retention_expiry_grants');
        expect(grant).toBeGreaterThan(-1);
        expect(body.indexOf('out of bounds (1..5000)')).toBeLessThan(grant);
        expect(body.indexOf('transcript_retention_invariant_violations')).toBeLessThan(grant);
        expect(body.indexOf('tombstone contradiction in scope')).toBeLessThan(grant);
    });

    it('no migration after the fix reintroduces session_replication_role into a function body', () => {
        const later = readdirSync(DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f >= FIX_FILE);
        expect(later).toContain(FIX_FILE);
        expect(later.filter((f) => /session_replication_role/i.test(code(M(f))))).toEqual([]);
    });
});
