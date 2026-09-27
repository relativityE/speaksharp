import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * #1258 — the durable session PRODUCT marker (PO-authorized; PM-accepted design, #1535 5848665275).
 *
 * Real Postgres (PGlite) running the real migration chain + the #1476 fence + the marker migration. The bootstrap is
 * the #1476 suite's, verbatim (the same RPC surface), plus the production read policy / column-update whitelist where a
 * test needs the `authenticated` role.
 */
const MIG_DIR = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const M = (f: string) => readFileSync(resolve(MIG_DIR, f), 'utf8');
const CHAIN = [
    '20260801000000_sessions_transcript_state.sql',
    '20260803000000_transcript_retention_newest_two.sql',
    '20260731120000_session_progress_evaluations.sql',
    '20260804000000_transcript_retention_converge_on_save.sql',
    '20260805000000_transcript_retention_preflight.sql',
    '20260819120000_complete_session_v2_atomic_retention_1314.sql',
    '20260908120000_transcript_retention_newest_one.sql',
    '20260607040000_active_recording_lease.sql',
];
const FENCE_MIGRATION = '20260923120000_one_active_engine_per_account_1476.sql';
export const PRODUCT_MIGRATION = '20260926190000_session_product_marker_1258.sql';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const FREE_USER = '33333333-3333-4333-8333-333333333333';
const L1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const K1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const K2 = 'bbbbbbbb-0000-4000-8000-000000000002';

const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  END $r$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  INSERT INTO auth.users (id) VALUES ('${U}'), ('${OTHER_USER}'), ('${FREE_USER}');
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $fn$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
  CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY, subscription_status text, trial_expires_at timestamptz,
    stripe_subscription_id text, subscription_id text, commercial_trial_granted_at timestamptz,
    trial_started_at timestamptz, updated_at timestamptz);
  INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${U}', 'pro'), ('${OTHER_USER}', 'pro'), ('${FREE_USER}', 'free');
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT CASE WHEN $1 = 'pro' THEN 'pro' ELSE 'free' END $fn$;
  CREATE TABLE public.tier_configs (tier_name text PRIMARY KEY, max_concurrent_sessions int);
  -- Pro's session cap is 50: only the account-wide lease can hold Pro to ONE engine.
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
    clarity_score double precision, wpm double precision, pause_metrics jsonb
  );
  CREATE TABLE public.usage_checkpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid, user_id uuid, incremental_seconds int, engine_type text,
    created_at timestamptz DEFAULT now());
  CREATE OR REPLACE FUNCTION public.update_user_usage(int, text, uuid)
    RETURNS jsonb LANGUAGE sql AS $fn$ SELECT jsonb_build_object('success', true) $fn$;
`;

async function db(): Promise<PGlite> {
    const d = new PGlite();
    await d.exec(BOOTSTRAP);
    for (const f of CHAIN) await d.exec(M(f));
    await d.query('SELECT public.activate_transcript_retention_newest_one()');
    await d.exec(M(FENCE_MIGRATION));
    if (existsSync(resolve(MIG_DIR, PRODUCT_MIGRATION))) await d.exec(M(PRODUCT_MIGRATION));
    await as(d, U);
    return d;
}
const as = (d: PGlite, user: string) => d.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [user]);

type J = Record<string, unknown>;
const acquire = async (d: PGlite, lease: string) =>
    (await d.query<{ r: J }>(`SELECT public.acquire_recording_lease($1::uuid, 'device', false) AS r`, [lease])).rows[0].r;
/** One call of the creation RPC, exactly as the client sends it (`p_session_data` JSONB + optional idempotency key). */
const create = async (d: PGlite, data: J, key?: string) =>
    (await d.query<{ r: J }>(`SELECT public.create_session_and_update_usage($1::jsonb, 'private', $2::uuid) AS r`,
        [JSON.stringify(data), key ?? null])).rows[0].r;
const created = (r: J) => r.new_session !== null && typeof r.new_session === 'object';
const idOf = (r: J) => (r.new_session as J).id as string;
const productOf = async (d: PGlite, id: string) =>
    (await d.query<{ product: string | null }>(`SELECT product FROM public.sessions WHERE id = $1`, [id])).rows[0].product;
const counts = async (d: PGlite) => (await d.query<{ s: number; u: number; l: number }>(
    `SELECT (SELECT count(*)::int FROM public.sessions) AS s, (SELECT count(*)::int FROM public.usage_checkpoints) AS u,
            (SELECT count(*)::int FROM public.active_recording_lease) AS l`)).rows[0];
/** A Start's placeholder take under the caller's live lease (the current client). */
const take = async (d: PGlite, extra: J = {}, key?: string) => {
    await acquire(d, L1);
    return create(d, { title: 'take', duration: 0, total_words: 0, lease_id: L1, ...extra }, key);
};

describe('#1258 — durable session product marker', () => {
    it('PRECONDITION: the marker migration exists', () => {
        expect(existsSync(resolve(MIG_DIR, PRODUCT_MIGRATION))).toBe(true);
    });

    it.each(['open_mic', 'focus_points'] as const)('a take created as %s stores that product in the same row', async (product) => {
        const d = await db();
        const r = await take(d, { product });
        expect(created(r)).toBe(true);
        expect(await productOf(d, idOf(r))).toBe(product);
    });

    it.each([
        ['absent (an old client)', {}],
        ['JSON null', { product: null }],
    ])('LEGACY: product %s → the row is created with product NULL (not guessed)', async (_label, extra) => {
        const d = await db();
        const r = await take(d, extra as J);
        expect(created(r)).toBe(true);
        expect(await productOf(d, idOf(r))).toBeNull();
    });

    it.each([
        ['an unknown string', 'unknown'],
        ['a near-miss', 'Open Mic'],
        ['a number', 5],
        ['an object', { p: 'open_mic' }],
    ])('INVALID (%s): refused with invalid_product BEFORE any side effect — no row, no usage, no lease change', async (_label, bad) => {
        const d = await db();
        await acquire(d, L1);
        const before = await counts(d);
        const leaseBefore = (await d.query(`SELECT lease_id, heartbeat_at FROM public.active_recording_lease`)).rows;
        const r = await create(d, { title: 'take', duration: 0, total_words: 0, lease_id: L1, product: bad }, K1);
        expect(r).toEqual({ new_session: null, usage_exceeded: false, error: 'invalid_product' });
        expect(JSON.stringify(r)).not.toContain('take'); // generic: no echo of the payload
        expect(await counts(d)).toEqual(before);
        expect((await d.query(`SELECT lease_id, heartbeat_at FROM public.active_recording_lease`)).rows).toEqual(leaseBefore);
        // The same idempotency key is still free: the refusal consumed nothing.
        expect(created(await create(d, { title: 'take', duration: 0, total_words: 0, lease_id: L1, product: 'open_mic' }, K1))).toBe(true);
    });

    it('SAVE-ONLY recovery (Retry Save) writes the product in the same INSERT', async () => {
        const d = await db();
        const r = await create(d, { title: 'recovered', duration: 45, total_words: 12, save_only: 'true', product: 'focus_points' }, K2);
        expect(created(r)).toBe(true);
        expect(await productOf(d, idOf(r))).toBe('focus_points');
        const legacy = await create(d, { title: 'recovered-old', duration: 45, total_words: 12, save_only: 'true' },
            'bbbbbbbb-0000-4000-8000-000000000003');
        expect(await productOf(d, idOf(legacy))).toBeNull();
    });

    it('IDEMPOTENT REPLAY keeps the FIRST stored product — a duplicate or a mismatching replay never rewrites it', async () => {
        const d = await db();
        const first = await take(d, { product: 'focus_points' }, K1);
        const id = idOf(first);
        const same = await create(d, { title: 'take', duration: 0, total_words: 0, lease_id: L1, product: 'focus_points' }, K1);
        const mismatch = await create(d, { title: 'take', duration: 0, total_words: 0, lease_id: L1, product: 'open_mic' }, K1);
        const omitted = await create(d, { title: 'take', duration: 0, total_words: 0, lease_id: L1 }, K1);
        for (const r of [same, mismatch, omitted]) {
            expect(created(r)).toBe(true);
            expect(idOf(r)).toBe(id);
        }
        expect(await productOf(d, id)).toBe('focus_points');
        expect((await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.sessions WHERE idempotency_key = $1`, [K1])).rows[0].n).toBe(1);
    });

    it('IMMUTABLE for every role: a stored product (or a legacy NULL) cannot be changed; other columns still update', async () => {
        const d = await db();
        const id = idOf(await take(d, { product: 'open_mic' }));
        await expect(d.query(`UPDATE public.sessions SET product = 'focus_points' WHERE id = $1`, [id])).rejects.toThrow(/product_immutable/);
        await expect(d.query(`UPDATE public.sessions SET product = NULL WHERE id = $1`, [id])).rejects.toThrow(/product_immutable/);
        await d.query(`UPDATE public.sessions SET title = 'renamed', updated_at = now() WHERE id = $1`, [id]);
        expect(await productOf(d, id)).toBe('open_mic');
        const legacy = idOf(await create(d, { title: 'old', duration: 0, total_words: 0, lease_id: L1 }));
        await expect(d.query(`UPDATE public.sessions SET product = 'open_mic' WHERE id = $1`, [legacy])).rejects.toThrow(/product_immutable/);
    });

    it('a direct INSERT with an invalid product is refused generically — the error carries no row content', async () => {
        const d = await db();
        const err = await d.query(
            `INSERT INTO public.sessions (user_id, title, transcript, product, status) VALUES ($1, 'SECRET-TITLE', 'SECRET-TRANSCRIPT', 'bogus', 'completed')`,
            [U]).then(() => null, (e: unknown) => e as Error & { detail?: string });
        expect(err).not.toBeNull();
        const text = `${err!.message} ${err!.detail ?? ''}`;
        expect(text).toMatch(/invalid_product/);
        expect(text).not.toMatch(/SECRET|Failing row/);
    });

    it('AUTHENTICATED: the owner reads their own product; another account sees no row; the column is not client-updatable', async () => {
        const d = await db();
        const id = idOf(await take(d, { product: 'focus_points' }));
        await d.exec(`
          -- The production column-level UPDATE whitelist (20260910193000), verbatim; the minimal bootstrap lacks one column.
          ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS custom_words jsonb;
          ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
          CREATE POLICY "Users can read own sessions" ON public.sessions FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
          CREATE POLICY "owner update (test)" ON public.sessions FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
          GRANT USAGE ON SCHEMA public, auth TO authenticated;
          GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
          GRANT SELECT ON public.sessions TO authenticated;
          GRANT UPDATE (
            title, duration, total_words, filler_words, custom_words, accuracy, ground_truth, transcript,
            clarity_score, wpm, status, status_reason, pause_metrics, transcript_state, updated_at
          ) ON public.sessions TO authenticated;`);
        await d.exec('SET ROLE authenticated');
        await as(d, U);
        expect((await d.query<{ product: string }>(`SELECT product FROM public.sessions WHERE id = $1`, [id])).rows).toEqual([{ product: 'focus_points' }]);
        await expect(d.query(`UPDATE public.sessions SET product = 'open_mic' WHERE id = $1`, [id])).rejects.toThrow(/permission denied|product_immutable/);
        await as(d, OTHER_USER);
        expect((await d.query(`SELECT product FROM public.sessions WHERE id = $1`, [id])).rows).toEqual([]);
        await d.exec('RESET ROLE');
        expect(await productOf(d, id)).toBe('focus_points');
    });
});
