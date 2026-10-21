/**
 * #1593 (live RWT case 12, run 39167876945) — A TAKE THAT REACHES THE 600 s CAP STAYS OPEN FOR ITS DEVICE'S SAVE.
 *
 * The deployed heartbeat_session (20260812041500_flawless_launch_runtime_convergence_1290.sql) marked the row `completed` /
 * `technical_duration_cap` at 600 s with no metrics, next action or transcript; the device's own completion was then refused
 * (idempotency conflict) and the take's save was lost. 20261019010000 keeps the cap for billing but never finalizes the take
 * in a heartbeat. Executed against the REAL migration chain plus the deployed heartbeat body (PGlite); true concurrency is
 * proven separately by tests/db/run-heartbeat-cap-realpg.sh.
 */
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
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
    '20260923120000_one_active_engine_per_account_1476.sql',
];
const FIX = '20261019010000_heartbeat_session_cap_keeps_take_open_1593.sql';
/** The DEPLOYED heartbeat_session: exactly the 1290 migration's definition and grants (the latest before FIX). */
const DEPLOYED_HEARTBEAT = (() => {
    const src = M('20260812041500_flawless_launch_runtime_convergence_1290.sql');
    const start = src.indexOf('CREATE OR REPLACE FUNCTION public.heartbeat_session(');
    const body = src.slice(start, src.indexOf('\n$$;', start) + 4);
    const grants = src.split('\n').filter((l) => /ON FUNCTION public\.heartbeat_session\(UUID, INT\)/.test(l)).join('\n');
    return `${body}\n${grants}\n`;
})();

const U = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const FREE_USER = '33333333-3333-4333-8333-333333333333';
const L1 = 'aaaaaaaa-0000-4000-8000-000000000001';

/** The bootstrap of the #1476 suite (one-active-engine-1476.integration.test.ts), unchanged. */
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

async function db(withFix: boolean): Promise<PGlite> {
    const d = new PGlite();
    await d.exec(BOOTSTRAP);
    for (const f of CHAIN) await d.exec(M(f));
    await d.query('SELECT public.activate_transcript_retention_newest_one()');
    await d.exec(DEPLOYED_HEARTBEAT);
    if (withFix) await d.exec(M(FIX));
    await asUser(d, U);
    return d;
}
const asUser = (d: PGlite, uid: string) => d.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);

type J = Record<string, unknown>;
const NEXT = { kind: 'practice_focus', focus: 'pace' };
const FILLERS = { um: 3 };
const L2 = 'aaaaaaaa-0000-4000-8000-000000000002';

/** A live take under its own lease, as the client starts one. */
async function startTake(d: PGlite, lease = L1): Promise<string> {
    await d.query(`SELECT public.acquire_recording_lease($1::uuid, 'device', false)`, [lease]);
    const r = (await d.query<{ r: J }>(`SELECT public.create_session_and_update_usage($1::jsonb, 'private') AS r`,
        [JSON.stringify({ title: 'take', duration: 0, total_words: 0, lease_id: lease })])).rows[0].r;
    return (r.new_session as J).id as string;
}
const heartbeat = async (d: PGlite, id: string, seconds: number) =>
    (await d.query<{ r: J }>(`SELECT public.heartbeat_session($1::uuid, $2) AS r`, [id, seconds])).rows[0].r;
/** Heartbeats every 30 s until the accrued duration is 570 s — one heartbeat short of the cap. */
async function recordTo570(d: PGlite, id: string) { for (let i = 0; i < 19; i += 1) await heartbeat(d, id, 30); }

/** The device's own completion of the take, as storage.ts completeSession sends it. */
const complete = (d: PGlite, id: string, o: { status?: string; next?: J | null; words?: number; transcript?: string | null } = {}) =>
    d.query<{ r: J }>(
        `SELECT public.complete_session_v2($1::uuid, $2, 600, NULL, $3::jsonb, $4, 72.5, 130, $5::jsonb, NULL, $6) AS r`,
        [id, o.status ?? 'completed', o.next === null ? null : JSON.stringify(o.next ?? NEXT), o.words ?? 1300, JSON.stringify(FILLERS),
            o.transcript === undefined ? 'the whole ten minute take' : o.transcript]);
const discard = (d: PGlite, id: string) => complete(d, id, { status: 'failed', next: null, transcript: null });

const row = async (d: PGlite, id: string) => (await d.query<{
    status: string; status_reason: string | null; duration: number; total_words: number | null;
    next_action_signal: J | null; transcript: string | null; expires_at: string | null;
}>(`SELECT status, status_reason, duration, total_words, next_action_signal, transcript, expires_at::text FROM public.sessions WHERE id = $1`, [id])).rows[0];
const billed = async (d: PGlite, id: string) =>
    Number((await d.query<{ n: string }>(`SELECT COALESCE(sum(incremental_seconds), 0)::text AS n FROM public.usage_checkpoints WHERE session_id = $1`, [id])).rows[0].n);

describe('#1593 — a heartbeat never finalizes a take at the 600 s cap; the device saves or discards it', () => {
    it('RED BASELINE: the deployed heartbeat closes the take at 600 s and the device\'s save is refused (live case 12)', async () => {
        const d = await db(false);
        const id = await startTake(d);
        await recordTo570(d, id);
        expect(await heartbeat(d, id, 30)).toMatchObject({ at_cap: true, final_status: 'completed' });
        expect(await row(d, id)).toMatchObject({ status: 'completed', status_reason: 'technical_duration_cap' });
        await expect(complete(d, id)).rejects.toThrow(/idempotency conflict/);
        expect((await row(d, id)).transcript, 'the take\'s words were lost').toBeNull();
    });

    it('SAVE: the heartbeat that reaches 600 s reports the cap, keeps the take open, and the device\'s completion saves it', async () => {
        const d = await db(true);
        const id = await startTake(d);
        await recordTo570(d, id);
        const before = (await row(d, id)).expires_at;
        expect(await heartbeat(d, id, 45)).toMatchObject({ success: true, at_cap: true, accepted_seconds: 30, duration: 600, remaining_seconds: 0, final_status: 'active' });
        const open = await row(d, id);
        expect(open).toMatchObject({ status: 'active', status_reason: null, duration: 600 });
        expect(open.expires_at! >= before!, 'the reaching heartbeat extends the expiry like any heartbeat').toBe(true);
        expect(await billed(d, id), 'billing still stops at the cap').toBe(600);
        expect((await complete(d, id)).rows[0].r).toMatchObject({ success: true });
        const saved = await row(d, id);
        expect(saved).toMatchObject({ status: 'completed', duration: 600, total_words: 1300 });
        expect(saved.next_action_signal).toEqual(NEXT);
        expect(saved.transcript).toBe('the whole ten minute take');
        expect((await complete(d, id)).rows[0].r, 'Retry Save replays idempotently').toMatchObject({ success: true });
    });

    it('AT THE CAP: further heartbeats accept and bill nothing, do not extend the expiry, and never close the take', async () => {
        const d = await db(true);
        const id = await startTake(d);
        await recordTo570(d, id);
        await heartbeat(d, id, 30);
        const capped = await row(d, id);
        for (let i = 0; i < 3; i += 1) {
            expect(await heartbeat(d, id, 30)).toMatchObject({ success: true, at_cap: true, accepted_seconds: 0, duration: 600, final_status: 'active' });
        }
        expect(await row(d, id)).toMatchObject({ status: 'active', duration: 600, expires_at: capped.expires_at });
        expect(await billed(d, id)).toBe(600);
    });

    it('DISCARD: a take at the cap can be discarded by its device', async () => {
        const d = await db(true);
        const id = await startTake(d);
        await recordTo570(d, id);
        await heartbeat(d, id, 30);
        expect((await discard(d, id)).rows[0].r).toMatchObject({ success: true });
        expect(await row(d, id)).toMatchObject({ status: 'failed', transcript: null });
    });

    it('LATE HEARTBEAT vs STOP: a heartbeat after the device saved changes nothing and reports the saved state', async () => {
        const d = await db(true);
        const id = await startTake(d);
        await recordTo570(d, id);
        await heartbeat(d, id, 30);
        await complete(d, id);
        const saved = await row(d, id);
        expect(await heartbeat(d, id, 30)).toMatchObject({ success: false, error: 'session_not_active', final_status: 'completed', at_cap: true });
        expect(await row(d, id)).toEqual(saved);
        expect(await billed(d, id)).toBe(600);
    });

    it('OWNERSHIP: another account\'s heartbeat never touches the take', async () => {
        const d = await db(true);
        const id = await startTake(d);
        await recordTo570(d, id);
        await heartbeat(d, id, 30);
        const mine = await row(d, id);
        await asUser(d, OTHER_USER);
        expect(await heartbeat(d, id, 30)).toMatchObject({ success: false, error: 'session_not_found' });
        await asUser(d, U);
        expect(await row(d, id)).toEqual(mine);
    });

    it('FENCED / DISPLACED: at the cap a displaced take is refused exactly as below it, and can still be saved', async () => {
        const d = await db(true);
        const id = await startTake(d);
        await recordTo570(d, id);
        await heartbeat(d, id, 30);
        // Another device takes over the account's one engine: the take at the cap is displaced (fenced).
        await d.query(`SELECT public.acquire_recording_lease($1::uuid, 'other device', true)`, [L2]);
        await expect(heartbeat(d, id, 30)).rejects.toThrow(/lease_revoked|recording_fenced/);
        expect(await row(d, id)).toMatchObject({ status: 'active', duration: 600 });
        expect((await complete(d, id)).rows[0].r, 'a displaced take may end with what it recorded').toMatchObject({ success: true });
        expect((await row(d, id)).status).toBe('completed');
    });

    it('EXPIRED: an abandoned take at the cap still expires on the ordinary path', async () => {
        const d = await db(true);
        const id = await startTake(d);
        await recordTo570(d, id);
        await heartbeat(d, id, 30);
        await d.exec(`UPDATE public.sessions SET expires_at = now() - interval '1 second' WHERE id = '${id}'`);
        await heartbeat(d, id, 30); // an at-cap heartbeat does not revive it
        expect(new Date((await row(d, id)).expires_at!).getTime()).toBeLessThan(Date.now());
        await d.query(`SELECT public.release_recording_lease($1::uuid)`, [L1]);
        await startTake(d, L2); // the next Start sweeps expired takes
        expect((await row(d, id)).status).toBe('failed');
    });

    it('LEASE: saving at the cap and releasing the lease lets the next take start', async () => {
        const d = await db(true);
        const id = await startTake(d);
        await recordTo570(d, id);
        await heartbeat(d, id, 30);
        await complete(d, id);
        await d.query(`SELECT public.release_recording_lease($1::uuid)`, [L1]);
        const next = await startTake(d, L2);
        expect((await row(d, next)).status).toBe('active');
    });

    it('SCOPE: the migration replaces heartbeat_session only, with its signature, definer, search_path and grants', () => {
        const sql = M(FIX);
        expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
        expect(sql).toContain('CREATE OR REPLACE FUNCTION public.heartbeat_session(\n    p_session_id UUID,\n    p_incremental_seconds INT\n) RETURNS JSONB');
        expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
        expect(sql).toContain('REVOKE EXECUTE ON FUNCTION public.heartbeat_session(UUID, INT) FROM PUBLIC, anon;');
        expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.heartbeat_session(UUID, INT) TO authenticated, service_role;');
        expect(sql).not.toMatch(/status\s*=\s*'completed'/);
        expect(sql).not.toMatch(/technical_duration_cap'/);
    });

    it('PINS the function digests the Production pre/postflight gate checks (scripts/postflight-gate-20261019010000.sh)', async () => {
        const gate = readFileSync(resolve(process.cwd(), 'scripts', 'postflight-gate-20261019010000.sh'), 'utf8');
        const pinned = (name: string) => gate.match(new RegExp(`^${name}=([0-9a-f]{32})`, 'm'))?.[1];
        const digest = async (d: PGlite) => (await d.query<{ m: string }>(
            `SELECT md5(pg_get_functiondef('public.heartbeat_session(uuid, integer)'::regprocedure)) AS m`)).rows[0].m;
        expect(await digest(await db(false)), 'BEFORE = the 20260812041500 body').toBe(pinned('HEARTBEAT_BEFORE_MD5'));
        expect(await digest(await db(true)), 'AFTER = this migration\'s body').toBe(pinned('HEARTBEAT_AFTER_MD5'));
    });
});
