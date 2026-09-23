// @vitest-environment node
//
// #1476 (PO rule, PM execution directive 5793499386): ONE ACCOUNT MAY ONLY RUN ONE STT ENGINE AT A TIME, across tabs
// and devices. The account-keyed `active_recording_lease` (20260607040000) is the authority; this suite proves the
// SERVER fences what the client cannot: a second device's Start, a displaced holder's writes, an OLD client that knows
// nothing about leases, Pro accounts (whose session cap is 50), and an abandoned device (#1360).
//
// Real PostgreSQL (PGlite) over the VERBATIM migration chain that defines `create_session_and_update_usage` and
// `complete_session_v2` today, plus the lease migration and the #1476 fence. Content-free: synthetic UUIDs only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
/** The #1476 fence under test. RED until it exists. */
export const FENCE_MIGRATION = '20260923120000_one_active_engine_per_account_1476.sql';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const FREE_USER = '33333333-3333-4333-8333-333333333333'; // Free tier (session cap 1)
const L1 = 'aaaaaaaa-0000-4000-8000-000000000001'; // device 1's lease for its take
const L2 = 'aaaaaaaa-0000-4000-8000-000000000002'; // device 2's lease

/** Same shape as the retention-writer suite, but `auth.uid()` follows the request claim so two accounts exist. */
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

/** The chain WITHOUT the fence, so a test can create state that exists before the migration applies. */
async function dbBeforeFence(): Promise<PGlite> {
    const d = new PGlite();
    await d.exec(BOOTSTRAP);
    for (const f of CHAIN) await d.exec(M(f));
    await d.query('SELECT public.activate_transcript_retention_newest_one()');
    await as(d, U);
    return d;
}

async function db(): Promise<PGlite> {
    const d = new PGlite();
    await d.exec(BOOTSTRAP);
    for (const f of CHAIN) await d.exec(M(f));
    await d.query('SELECT public.activate_transcript_retention_newest_one()');
    if (existsSync(resolve(MIG_DIR, FENCE_MIGRATION))) await d.exec(M(FENCE_MIGRATION));
    await as(d, U);
    return d;
}
const as = (d: PGlite, user: string) => d.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [user]);

type J = Record<string, unknown>;
const acquire = async (d: PGlite, lease: string, force = false) =>
    (await d.query<{ r: J }>(`SELECT public.acquire_recording_lease($1::uuid, 'device', $2) AS r`, [lease, force])).rows[0].r;
const heartbeat = async (d: PGlite, lease: string) =>
    (await d.query<{ r: J }>(`SELECT public.heartbeat_recording_lease($1::uuid) AS r`, [lease])).rows[0].r;
/** A Start's placeholder create, as the client sends it; `lease` omitted = an OLD client that knows no leases. */
const start = async (d: PGlite, lease?: string) =>
    (await d.query<{ r: J }>(`SELECT public.create_session_and_update_usage($1::jsonb, 'private') AS r`,
        [JSON.stringify({ title: 'take', duration: 0, total_words: 0, ...(lease ? { lease_id: lease } : {}) })])).rows[0].r;
/** The writer's contract: a created row comes back as `new_session`; a refusal carries `new_session: null` + `error`. */
const created = (r: J) => r.new_session !== null && typeof r.new_session === 'object';
const sessionId = (r: J) => (created(r) ? (r.new_session as J).id : undefined) as string | undefined;
const leaseRow = async (d: PGlite, user = U) =>
    (await d.query<{ lease_id: string; heartbeat_at: string }>(
        `SELECT lease_id, heartbeat_at FROM public.active_recording_lease WHERE user_id = $1`, [user])).rows[0];
/** An old client's completion: the direct RLS update `storage.ts updateSession` performs. */
const directComplete = (d: PGlite, id: string) =>
    d.query(`UPDATE public.sessions SET status = 'completed', duration = 60, updated_at = now() WHERE id = $1`, [id]);
/** What `heartbeat_session` does while recording: accrue duration on a still-active take. */
const keepRecording = (d: PGlite, id: string) =>
    d.query(`UPDATE public.sessions SET duration = COALESCE(duration, 0) + 30, updated_at = now() WHERE id = $1`, [id]);
const statusOf = async (d: PGlite, id: string) =>
    (await d.query<{ status: string; status_reason: string | null }>(`SELECT status, status_reason FROM public.sessions WHERE id = $1`, [id])).rows[0];

describe('#1476 — one account, one authorized active engine (server fence)', () => {
    it('PRECONDITION: the fence migration exists (RED until implemented)', () => {
        expect(existsSync(resolve(MIG_DIR, FENCE_MIGRATION))).toBe(true);
    });

    it('CASUALTY: a second device holding no live lease cannot create a session while the first device\'s take is live', async () => {
        const d = await db();
        expect(await acquire(d, L1)).toMatchObject({ acquired: true });
        const first = await start(d, L1);
        expect(created(first), 'device 1 records under its own live lease').toBe(true);

        expect(await acquire(d, L2), 'device 2 is told the truth').toMatchObject({ acquired: false, reason: 'held_by_other' });
        const second = await start(d, L2);
        expect(created(second), 'the server refuses a Start under a lease it does not hold').toBe(false);
        expect(second.error).toBe('lease_not_held');
    });

    it('CASUALTY: an explicit takeover displaces device 1 — it can no longer RECORD against the account, but its take can be SAVED', async () => {
        const d = await db();
        await acquire(d, L1);
        const id = sessionId(await start(d, L1)) as string;
        expect(id).toBeTruthy();

        expect(await acquire(d, L2, true)).toMatchObject({ acquired: true, took_over: true });
        expect(await heartbeat(d, L1), 'device 1 learns it was displaced').toMatchObject({ valid: false, reason: 'revoked' });
        await expect(keepRecording(d, id), 'continuing the displaced take is refused').rejects.toThrow(/lease/i);
        expect(created(await start(d, L2)), 'the new holder records').toBe(true);
        await directComplete(d, id);
        expect((await statusOf(d, id)).status, 'what device 1 recorded is saved (PM directive: recoverable)').toBe('completed');
    });

    it('CASUALTY (OLD CLIENT): a Start with no lease is refused with the code old bundles already handle while another take is live', async () => {
        const d = await db();
        await acquire(d, L1);
        expect(created(await start(d, L1))).toBe(true);
        const old = await start(d); // an old bundle: no lease_id at all
        expect(created(old)).toBe(false);
        expect(old.error, 'the existing #1360 code, which old bundles already render').toBe('max_concurrent_sessions_reached');
    });

    it('CONTROL (OLD CLIENT): alone, an old client records under an implicit lease that blocks a new device, and completing releases it', async () => {
        const d = await db();
        const id = sessionId(await start(d)) as string;
        expect(id, 'the old client can still record').toBeTruthy();
        expect((await leaseRow(d))?.lease_id, 'the server holds an implicit lease for the legacy take').toBe(id);
        expect(await acquire(d, L2), 'a new device sees the legacy take as live').toMatchObject({ acquired: false, reason: 'held_by_other' });

        await directComplete(d, id);
        expect(await leaseRow(d), 'completion releases the implicit lease').toBeUndefined();
        expect(await acquire(d, L2)).toMatchObject({ acquired: true });
    });

    it('CASUALTY (Pro = 1): a Pro account with a session cap of 50 still gets ONE engine', async () => {
        const d = await db();
        await acquire(d, L1);
        expect(created(await start(d, L1))).toBe(true);
        expect(created(await start(d, L2)), 'the cap does not override the account rule').toBe(false);
        expect(created(await start(d)), 'nor does an old client').toBe(false);
    });

    it('CASUALTY (#1360 bounded recovery): a returning user records at once past an abandoned device, and that device can still SAVE its take', async () => {
        const d = await db();
        await acquire(d, L1);
        const id = sessionId(await start(d, L1)) as string;
        await d.query(`UPDATE public.active_recording_lease SET heartbeat_at = now() - interval '20 seconds' WHERE user_id = $1`, [U]);

        expect(await acquire(d, L2), 'a stale lease is free').toMatchObject({ acquired: true });
        expect(created(await start(d, L2)), 'the returning user records at once — no 5-minute lockout').toBe(true);
        await expect(keepRecording(d, id), 'the abandoned device cannot keep recording').rejects.toThrow(/lease/i);
        await directComplete(d, id);
        expect((await statusOf(d, id)).status, 'but reconnecting, it can save what it recorded').toBe('completed');
    });

    it('CASUALTY (Free tier, cap 1): the device that took over records although the displaced take is still active and saving', async () => {
        const d = await db();
        await d.exec(`CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
            RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'free'::text $fn$;`);
        await acquire(d, L1);
        const id = sessionId(await start(d, L1)) as string;
        await acquire(d, L2, true);
        expect(created(await start(d, L2)), 'the legacy session cap does not count the displaced leased take').toBe(true);
        await directComplete(d, id);
        expect((await statusOf(d, id)).status).toBe('completed');
    });

    it.each([
        ['Pro (session cap 50)', U],
        ['Free (session cap 1)', FREE_USER],
    ])('CASUALTY (Codex P1 on 040da46a): %s — a take ALREADY RECORDING when the migration applies is fenced; only one engine stays authorized', async (_tier, user) => {
        const d = await dbBeforeFence();
        await as(d, user);
        const legacy = sessionId(await start(d)) as string; // created by the previous writer: no lease, no lease row
        await d.exec(M(FENCE_MIGRATION));

        expect((await leaseRow(d, user))?.lease_id, 'the migration gives the running take the account lease').toBe(legacy);
        expect(await acquire(d, L2), 'a new device is blocked without take-over').toMatchObject({ acquired: false, reason: 'held_by_other' });
        expect(created(await start(d, L2)), 'a current client cannot record beside it').toBe(false);
        expect(created(await start(d)), 'nor can a second OLD client').toBe(false);
        await keepRecording(d, legacy); // the old client's own heartbeat keeps its lease alive
        expect(await acquire(d, L2, true)).toMatchObject({ acquired: true, took_over: true });
        await expect(keepRecording(d, legacy), 'after a take-over it can no longer record').rejects.toThrow(/lease/i);
        expect(created(await start(d, L2)), 'the take-over device records').toBe(true);
        await directComplete(d, legacy);
        expect((await statusOf(d, legacy)).status, 'but what it recorded is saved').toBe('completed');
        const live = await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.sessions WHERE user_id = $1 AND status = 'active'`, [user]);
        expect(live.rows[0].n, 'exactly one engine authorized').toBe(1);
    });

    it('CONTROL (owner isolation): another account\'s live take never blocks this account', async () => {
        const d = await db();
        await as(d, OTHER_USER);
        await acquire(d, L1);
        expect(created(await start(d, L1))).toBe(true);
        await as(d, U);
        expect(await acquire(d, L2)).toMatchObject({ acquired: true });
        expect(created(await start(d, L2))).toBe(true);
    });

    it('CASUALTY (normal stop ≠ displaced): a take stopped and released normally still saves after another device starts', async () => {
        // Stop on device 1 releases its lease; device 2 starts at once; device 1's save (or Retry Save) lands later.
        // Rejecting it would lose a take the user stopped correctly — only a DISPLACED holder is fenced.
        const d = await db();
        await acquire(d, L1);
        const id = sessionId(await start(d, L1)) as string;
        await d.query(`SELECT public.release_recording_lease($1::uuid)`, [L1]);
        await acquire(d, L2);
        expect(created(await start(d, L2)), 'device 2 records').toBe(true);
        await directComplete(d, id);
        expect((await statusOf(d, id)).status, 'the stopped take still completes').toBe('completed');
    });

    it('CASUALTY: a take that has FAILED stays closed — no later completion or transcript', async () => {
        const d = await db();
        await acquire(d, L1);
        const id = sessionId(await start(d, L1)) as string;
        await acquire(d, L2, true);
        await d.query(`UPDATE public.sessions SET status = 'failed', status_reason = 'discarded_after_takeover', updated_at = now() WHERE id = $1`, [id]);
        expect((await statusOf(d, id)).status, 'a displaced take may be discarded').toBe('failed');
        await expect(directComplete(d, id), 'and then never revived').rejects.toThrow(/lease/i);
        await expect(d.query(`UPDATE public.sessions SET transcript = 'late words' WHERE id = $1`, [id])).rejects.toThrow(/lease/i);
    });

    it('CASUALTY (bypassing client): a direct RLS insert of an active take cannot skip the fence', async () => {
        const d = await db();
        await acquire(d, L1);
        expect(created(await start(d, L1))).toBe(true);
        const direct = (lease: string | null) => d.query(
            `INSERT INTO public.sessions (user_id, status, duration, lease_id) VALUES ($1, 'active', 0, $2::uuid)`, [U, lease]);
        await expect(direct(null), 'no lease at all').rejects.toThrow(/lease/i);
        await expect(direct(L2), 'a lease it does not hold').rejects.toThrow(/lease/i);
    });

    it('CONTROL: the holder\'s own take completes, and a later take by the same device starts', async () => {
        const d = await db();
        await acquire(d, L1);
        const id = sessionId(await start(d, L1)) as string;
        await directComplete(d, id);
        expect((await statusOf(d, id)).status).toBe('completed');
        await d.query(`SELECT public.release_recording_lease($1::uuid)`, [L1]);
        await acquire(d, L2);
        expect(created(await start(d, L2))).toBe(true);
    });
});
