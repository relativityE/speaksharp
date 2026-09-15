// @vitest-environment node
//
// #1472 — the persisted filler-evidence completeness authority (additive schema + completion RPC).
//
// Real PostgreSQL (PGlite) over the REAL migration chain that defines complete_session_v2 today, then this migration.
// Bootstrap mirrors the #1436 atomicity suite: only what the completion RPC reaches, with usage and tier stubbed to
// succeed so every outcome here is attributable to the completeness change alone. Content-free: synthetic UUIDs.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const CHAIN = [
    '20260801000000_sessions_transcript_state.sql',
    '20260803000000_transcript_retention_newest_two.sql',
    '20260731120000_session_progress_evaluations.sql',
    '20260804000000_transcript_retention_converge_on_save.sql',
    '20260805000000_transcript_retention_preflight.sql',
    '20260819120000_complete_session_v2_atomic_retention_1314.sql',
    '20260908120000_transcript_retention_newest_one.sql',
];
const COMPLETENESS = '20260915170000_filler_completeness_authority_1472.sql';

const U = '11111111-1111-4111-8111-111111111111';

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
    clarity_score double precision, wpm double precision, pause_metrics jsonb
  );
  CREATE TABLE public.usage_checkpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid, user_id uuid, incremental_seconds int, engine_type text,
    created_at timestamptz DEFAULT now());
  CREATE OR REPLACE FUNCTION public.update_user_usage(int, text, uuid)
    RETURNS jsonb LANGUAGE sql AS $fn$ SELECT jsonb_build_object('success', true) $fn$;
`;

async function freshDb({ withCompleteness }: { withCompleteness: boolean }): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(BOOTSTRAP);
    for (const m of CHAIN) await db.exec(M(m));
    if (withCompleteness) await db.exec(M(COMPLETENESS));
    return db;
}

const NEXT_ACTION = { kind: 'repeat_same', reason: 'steady_progress' };

async function activeSession(db: PGlite): Promise<string> {
    const res = await db.query<{ id: string }>(
        `INSERT INTO public.sessions (user_id, status, duration, total_words) VALUES ($1, 'active', 90, 0) RETURNING id`, [U]);
    return res.rows[0].id;
}

/** The eleven arguments an older client sends, by name, exactly as `completeSession` does. */
const elevenArgs = (sessionId: string) => ({
    p_session_id: sessionId, p_status: 'completed', p_final_duration: 90, p_reason: null,
    p_next_action: JSON.stringify(NEXT_ACTION), p_total_words: 140, p_clarity_score: 88, p_wpm: 93,
    p_filler_counts: '{}', p_pause_metrics: '{}', p_final_transcript: null,
});

async function complete(db: PGlite, sessionId: string, completeness?: string | null) {
    const args: Record<string, unknown> = elevenArgs(sessionId);
    if (completeness !== undefined) args.p_filler_completeness = completeness;
    const names = Object.keys(args);
    const casts: Record<string, string> = { p_next_action: '::jsonb', p_filler_counts: '::jsonb', p_pause_metrics: '::jsonb' };
    const sql = `SELECT public.complete_session_v2(${names.map((n, i) => `${n} => $${i + 1}${casts[n] ?? ''}`).join(', ')}) AS r`;
    return db.query<{ r: Record<string, unknown> }>(sql, names.map((n) => args[n]));
}

const stored = async (db: PGlite, sessionId: string) =>
    (await db.query<{ filler_completeness: string | null; status: string }>(
        `SELECT filler_completeness, status FROM public.sessions WHERE id = $1`, [sessionId])).rows[0];

describe('#1472 — filler completeness authority (schema + complete_session_v2)', () => {
    it('PRECONDITION (RED): before the migration a completion cannot state completeness', async () => {
        const db = await freshDb({ withCompleteness: false });
        const s = await activeSession(db);
        await expect(complete(db, s, 'unobservable')).rejects.toThrow(/does not exist|function/i);
    });

    it.each(['complete', 'unobservable', 'no_speech'])('CASUALTY: a completion persists the closed state %s', async (state) => {
        const db = await freshDb({ withCompleteness: true });
        const s = await activeSession(db);
        const r = (await complete(db, s, state)).rows[0].r;
        expect(r.success).toBe(true);
        expect(await stored(db, s)).toEqual({ filler_completeness: state, status: 'completed' });
    });

    it('CASUALTY: an unknown completeness value is refused (23514) and the session stays uncompleted', async () => {
        const db = await freshDb({ withCompleteness: true });
        const s = await activeSession(db);
        await expect(complete(db, s, 'verified_zero')).rejects.toMatchObject({ code: '23514' });
        expect(await stored(db, s)).toEqual({ filler_completeness: null, status: 'active' });
    });

    it('CASUALTY (old client + new DB): the eleven named arguments still complete, leaving completeness NULL (fail closed)', async () => {
        const db = await freshDb({ withCompleteness: true });
        const s = await activeSession(db);
        const r = (await complete(db, s)).rows[0].r;
        expect(r.success).toBe(true);
        expect(await stored(db, s)).toEqual({ filler_completeness: null, status: 'completed' });
    });

    it('CASUALTY: exactly ONE complete_session_v2 exists, so a named call can never be ambiguous', async () => {
        const db = await freshDb({ withCompleteness: true });
        const rows = (await db.query<{ args: string }>(
            `SELECT pg_get_function_identity_arguments(p.oid) AS args
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'complete_session_v2'`)).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0].args).toMatch(/p_filler_completeness text$/);
    });

    it('CASUALTY: an identical replay stays idempotent; a replay stating a DIFFERENT completeness conflicts (40003)', async () => {
        const db = await freshDb({ withCompleteness: true });
        const s = await activeSession(db);
        expect((await complete(db, s, 'unobservable')).rows[0].r.success).toBe(true);
        const replay = (await complete(db, s, 'unobservable')).rows[0].r;
        expect(replay.idempotent).toBe(true);
        await expect(complete(db, s, 'complete')).rejects.toMatchObject({ code: '40003' });
        expect(await stored(db, s)).toEqual({ filler_completeness: 'unobservable', status: 'completed' });
    });

    it('CONTROL: a replay that omits completeness (older client retrying) is still an identical replay', async () => {
        const db = await freshDb({ withCompleteness: true });
        const s = await activeSession(db);
        expect((await complete(db, s, 'no_speech')).rows[0].r.success).toBe(true);
        expect((await complete(db, s)).rows[0].r.idempotent).toBe(true);
        expect((await stored(db, s)).filler_completeness).toBe('no_speech');
    });

    it('CONTROL: the column itself refuses a value outside the closed set, whoever writes it', async () => {
        const db = await freshDb({ withCompleteness: true });
        const s = await activeSession(db);
        await expect(db.query(`UPDATE public.sessions SET filler_completeness = 'clean' WHERE id = $1`, [s]))
            .rejects.toThrow(/sessions_filler_completeness_closed|check constraint/i);
    });

    it('CONTROL: the grants are restated on the new signature — authenticated and service_role may execute, PUBLIC may not', async () => {
        const db = await freshDb({ withCompleteness: true });
        const sig = `public.complete_session_v2(uuid, text, integer, text, jsonb, integer, double precision, double precision, jsonb, jsonb, text, text)`;
        const can = async (role: string) => (await db.query<{ ok: boolean }>(
            `SELECT has_function_privilege($1, '${sig}', 'EXECUTE') AS ok`, [role])).rows[0].ok;
        expect(await can('authenticated')).toBe(true);
        expect(await can('service_role')).toBe(true);
        expect(await can('anon')).toBe(false);
    });
});
