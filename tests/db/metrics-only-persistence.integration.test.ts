// @vitest-environment node
//
// #1306 — EXECUTED proof of the FINAL metrics-only schema (Stage A + Stage B) on real PostgreSQL (PGlite):
// content columns removed (no CASCADE); the recommendation contract enforced; a content-free preflight fails
// closed on legacy completed rows lacking a recommendation; unrelated schema (RPCs, views, RLS policies,
// tables) survives Stage B; and named-parameter RPC routing selects the new overload in Stage A and the old
// overload is absent after Stage B. Content-free: synthetic strings only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const STAGE_A = M('20260816223606_metrics_only_additive_1306.sql');
const STAGE_B = M('20260816223607_metrics_only_enforcement_1306.sql');
const U = '11111111-1111-4111-8111-111111111111';

// BEFORE state: content columns present; the LEGACY transcript-accepting complete_session overload present; and
// UNRELATED objects (a table, a view, an RLS policy, a function) that MUST survive Stage B.
const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $r$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT '${U}'::uuid $fn$;
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY, subscription_status text, trial_expires_at timestamptz,
    stripe_subscription_id text, subscription_id text, commercial_trial_granted_at timestamptz);
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz,
    transcript text, ai_suggestions jsonb, ground_truth text, accuracy double precision,
    transcript_state text DEFAULT 'not_captured',
    total_words int, duration int, clarity_score double precision, wpm double precision,
    filler_words jsonb, pause_metrics jsonb, status text, status_reason text);
  CREATE TABLE public.user_issue_reports (id uuid PRIMARY KEY, user_id uuid, transcript_excerpt text, note text);
  -- Legacy transcript-accepting overload (Stage B must remove it).
  CREATE FUNCTION public.complete_session(p_session_id uuid, p_status text DEFAULT 'completed',
    p_final_transcript text DEFAULT NULL, p_final_duration integer DEFAULT NULL, p_reason text DEFAULT NULL)
    RETURNS jsonb LANGUAGE sql AS $fn$ SELECT jsonb_build_object('overload','old') $fn$;
  -- UNRELATED objects that must SURVIVE Stage B.
  CREATE TABLE public.keep_me (id int PRIMARY KEY, label text);
  CREATE VIEW public.keep_view AS SELECT id, total_words FROM public.sessions;
  CREATE FUNCTION public.keep_fn() RETURNS int LANGUAGE sql AS $fn$ SELECT 42 $fn$;
  ALTER TABLE public.keep_me ENABLE ROW LEVEL SECURITY;
  CREATE POLICY keep_policy ON public.keep_me FOR SELECT USING (true);
`;

let seq = 0;
const sid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;
const VALID_REC = JSON.stringify({ reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1' });

async function withA(): Promise<PGlite> { const db = new PGlite(); await db.exec(BOOTSTRAP); await db.exec(STAGE_A); return db; }
async function withAB(): Promise<PGlite> { const db = await withA(); await db.exec(STAGE_B); return db; }
const colN = (db: PGlite, t: string, cols: string[]) =>
  db.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name = ANY($2)`, [t, cols]);
const objExists = (db: PGlite, sql: string, p: unknown[] = []) => db.query<{ n: number }>(sql, p).then(r => r.rows[0].n);

describe('#1306 FINAL metrics-only schema (Stage A + B)', () => {
  it('drops the content columns (no CASCADE) and keeps the metrics + recommendation columns', async () => {
    const db = await withAB();
    expect((await colN(db, 'sessions', ['transcript', 'ai_suggestions', 'ground_truth', 'accuracy'])).rows[0].n).toBe(0);
    expect((await colN(db, 'user_issue_reports', ['transcript_excerpt'])).rows[0].n).toBe(0);
    expect((await colN(db, 'sessions', ['recommendation_signals', 'total_words', 'clarity_score', 'wpm', 'pause_metrics'])).rows[0].n).toBe(5);
  });

  it('a write naming a removed content column fails (the field no longer exists)', async () => {
    const db = await withAB();
    await expect(db.query(`INSERT INTO public.sessions (id, user_id, transcript) VALUES ($1,$2,'um so')`, [sid(), U]))
      .rejects.toThrow(/column "transcript" .* does not exist/i);
  });

  it('the recommendation CHECK stays prose-proof and completed requires a recommendation', async () => {
    const db = await withAB();
    await expect(db.query(`INSERT INTO public.sessions (id, user_id, status) VALUES ($1,$2,'completed')`, [sid(), U]))
      .rejects.toThrow(/completed session requires exactly one structured recommendation/);
    await expect(db.query(`INSERT INTO public.sessions (id, user_id, status, recommendation_signals) VALUES ($1,$2,'completed',$3)`, [sid(), U, VALID_REC]))
      .resolves.toBeDefined();
    const prose = JSON.stringify({ ...JSON.parse(VALID_REC), what_to_try_next: 'slow down' });
    await expect(db.query(`INSERT INTO public.sessions (id, user_id, status, recommendation_signals) VALUES ($1,$2,'active',$3)`, [sid(), U, prose]))
      .rejects.toThrow(/sessions_recommendation_signals_shape/);
  });

  it('UNRELATED schema survives Stage B (no CASCADE collateral): table, view, function, RLS policy', async () => {
    const db = await withAB();
    expect(await objExists(db, `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='keep_me'`)).toBe(1);
    expect(await objExists(db, `SELECT count(*)::int AS n FROM information_schema.views WHERE table_schema='public' AND table_name='keep_view'`)).toBe(1);
    expect(await objExists(db, `SELECT count(*)::int AS n FROM pg_proc WHERE proname='keep_fn'`)).toBe(1);
    expect(await objExists(db, `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='keep_me' AND policyname='keep_policy'`)).toBe(1);
  });
});

describe('#1306 Stage B content-free preflight — fails closed on legacy completed rows without a recommendation', () => {
  it('FAILS Stage B if a completed row lacks recommendation_signals (counts only, never reads content)', async () => {
    const db = await withA();
    await db.query(`INSERT INTO public.sessions (id, user_id, status, total_words) VALUES ($1,$2,'completed',10)`, [sid(), U]); // legacy canary/test row
    await expect(db.exec(STAGE_B)).rejects.toThrow(/Stage B preflight: .* completed session row\(s\) lack recommendation_signals/);
  });

  it('SUCCEEDS after the authorized scrub hard-deletes the offending legacy row', async () => {
    const db = await withA();
    const bad = sid();
    await db.query(`INSERT INTO public.sessions (id, user_id, status, total_words) VALUES ($1,$2,'completed',10)`, [bad, U]);
    await db.query(`DELETE FROM public.sessions WHERE id=$1`, [bad]); // scrub (hard delete, content-free)
    await expect(db.exec(STAGE_B)).resolves.not.toThrow();
  });
});

describe('#1306 named-parameter RPC routing', () => {
  it('Stage A: a call with p_recommendation selects the NEW overload; p_final_transcript selects the OLD', async () => {
    const db = await withA();
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [U]);
    await db.query(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ($1,'pro')`, [U]);
    const s = sid();
    await db.query(`INSERT INTO public.sessions (id, user_id, status, duration) VALUES ($1,$2,'active',30)`, [s, U]);
    // Named p_recommendation → NEW overload runs (returns final_status), not the old stub.
    const neu = (await db.query<{ r: { final_status?: string; overload?: string } }>(
      `SELECT public.complete_session(p_session_id => $1::uuid, p_status => 'completed', p_recommendation => $2::jsonb, p_total_words => 100) AS r`, [s, VALID_REC])).rows[0].r;
    expect(neu.overload).toBeUndefined();
    expect(neu.final_status).toBe('completed');
    // Named p_final_transcript → OLD overload runs (returns the stub marker).
    const old = (await db.query<{ r: { overload?: string } }>(
      `SELECT public.complete_session(p_session_id => $1::uuid, p_final_transcript => 'x') AS r`, [sid()])).rows[0].r;
    expect(old.overload).toBe('old');
  });

  it('Stage B: the old transcript-accepting overload is ABSENT (only the transcript-free one remains)', async () => {
    const db = await withAB();
    const rows = await db.query<{ args: string }>(`SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='complete_session'`);
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].args).not.toMatch(/transcript/i);
    await expect(db.query(`SELECT public.complete_session(p_session_id => $1::uuid, p_final_transcript => 'x')`, [sid()]))
      .rejects.toThrow(/does not exist|function .* does not exist/i);
  });
});
