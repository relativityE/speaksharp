// @vitest-environment node
//
// #1306 — RPC-LEVEL proof that `complete_session` (Stage A): never accepts transcript; writes EVERY retained
// final metric + exactly one structured next action ATOMICALLY; rolls the WHOLE completion back on a
// missing/invalid next action; is STRICTLY idempotent (identical replay incl. every metric = no-op; any
// mismatch = conflict, no partial update). Real PostgreSQL (PGlite).
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STAGE_A = readFileSync(
  resolve(process.cwd(), 'backend', 'supabase', 'migrations', '20260816223606_metrics_only_additive_1306.sql'), 'utf8');
const U = '11111111-1111-4111-8111-111111111111';

const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  END $r$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT '${U}'::uuid $fn$;
  CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY, subscription_status text, trial_expires_at timestamptz,
    stripe_subscription_id text, subscription_id text, commercial_trial_granted_at timestamptz);
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz,
    transcript text, ai_suggestions jsonb, ground_truth text, accuracy double precision,
    transcript_state text DEFAULT 'not_captured', next_action_signal jsonb,
    total_words int, duration int, clarity_score double precision, wpm double precision,
    filler_counts jsonb, pause_metrics jsonb, status text, status_reason text);
`;

const REC_A = { reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1' };
const REC_B = { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' };
const DEFAULT_METRICS = { totalWords: 120, clarity: 0.9, wpm: 140, filler: { um: 2, uh: 1 }, pause: { totalPauses: 1, averagePauseDuration: 0.4 } };
const INVALID = { ...REC_A, what_to_try_next: 'Slow down a touch.' };

let seq = 0;
const sid = () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++seq).padStart(12, '0')}`;

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(STAGE_A);
  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [U]);
  await db.query(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ($1,'pro')`, [U]);
  return db;
}
async function seedActive(db: PGlite): Promise<string> {
  const id = sid();
  await db.query(`INSERT INTO public.sessions (id, user_id, status, duration, total_words) VALUES ($1,$2,'active',30,50)`, [id, U]);
  return id;
}
type Opts = Partial<typeof DEFAULT_METRICS & { duration: number; reason: string }>;
const complete = (db: PGlite, id: string, rec: unknown, opts: Opts = {}) => {
  const o = { duration: 60, reason: 'done', ...DEFAULT_METRICS, ...opts };
  return db.query<{ r: { success: boolean; idempotent?: boolean; next_action_signal?: unknown } }>(
    `SELECT public.complete_session($1,'completed',$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9::jsonb) AS r`,
    [id, o.duration, o.reason, rec === undefined ? null : JSON.stringify(rec), o.totalWords, o.clarity, o.wpm, JSON.stringify(o.filler), JSON.stringify(o.pause)]);
};
const rowOf = async (db: PGlite, id: string) =>
  (await db.query<{ status: string; next_action_signal: unknown; total_words: number; clarity_score: number; wpm: number }>(
    `SELECT status, next_action_signal, total_words, clarity_score, wpm FROM public.sessions WHERE id=$1`, [id])).rows[0];

describe('#1306 complete_session — atomic completion (metrics + next action), fail-closed, strictly idempotent', () => {
  let db: PGlite;
  beforeEach(async () => { db = await freshDb(); });

  it('writes EVERY retained final metric + the next action atomically on success', async () => {
    const id = await seedActive(db);
    expect((await complete(db, id, REC_A)).rows[0].r.success).toBe(true);
    const row = await rowOf(db, id);
    expect(row.status).toBe('completed');
    expect(row.next_action_signal).toEqual(REC_A);
    expect(row.total_words).toBe(120);
    expect(row.clarity_score).toBe(0.9);
    expect(row.wpm).toBe(140);
  });

  it('ROLLS BACK the whole completion when the next action is MISSING', async () => {
    const id = await seedActive(db);
    await expect(complete(db, id, undefined)).rejects.toThrow(/completed session requires exactly one structured next action/);
    const row = await rowOf(db, id);
    expect(row.status).toBe('active');
    expect(row.total_words).toBe(50); // metrics NOT partially written
  });

  it('ROLLS BACK the whole completion when the next action is INVALID (prose)', async () => {
    const id = await seedActive(db);
    await expect(complete(db, id, INVALID)).rejects.toThrow(/sessions_next_action_signal_shape/);
    expect((await rowOf(db, id)).status).toBe('active');
  });

  it('IDENTICAL replay (same metrics + next action) is a no-op success', async () => {
    const id = await seedActive(db);
    await complete(db, id, REC_A);
    const replay = (await complete(db, id, REC_A)).rows[0].r;
    expect(replay.idempotent).toBe(true);
    expect(replay.next_action_signal).toEqual(REC_A);
  });

  it('MISMATCHED replay (any metric, duration, reason, or next action) conflicts with no partial update', async () => {
    const id = await seedActive(db);
    await complete(db, id, REC_A);
    await expect(complete(db, id, REC_B)).rejects.toThrow(/idempotency conflict/);                 // next action
    await expect(complete(db, id, REC_A, { duration: 90 })).rejects.toThrow(/idempotency conflict/); // duration
    await expect(complete(db, id, REC_A, { reason: 'other' })).rejects.toThrow(/idempotency conflict/); // reason
    await expect(complete(db, id, REC_A, { totalWords: 999 })).rejects.toThrow(/idempotency conflict/); // METRIC
    await expect(complete(db, id, REC_A, { clarity: 0.1 })).rejects.toThrow(/idempotency conflict/);    // METRIC
    const row = await rowOf(db, id);
    expect(row.next_action_signal).toEqual(REC_A);
    expect(row.total_words).toBe(120); // first completion untouched
  });

  it('REJECTS a completed session with NULL filler_counts (never coerced to {} — no fabricated zero)', async () => {
    const id = await seedActive(db);
    await expect(db.query(
      `SELECT public.complete_session($1,'completed',$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb) AS r`,
      [id, 60, 'done', JSON.stringify(REC_A), 120, 0.9, 140, null, JSON.stringify({ totalPauses: 1 })]))
      .rejects.toThrow(/requires a measured filler_counts map/);
    expect((await rowOf(db, id)).status).toBe('active'); // rolled back — not completed with a fabricated zero
  });

  it('ACCEPTS a completed session with an EXPLICIT {} filler_counts (a genuine measured zero)', async () => {
    const id = await seedActive(db);
    const r = (await db.query<{ r: { success: boolean } }>(
      `SELECT public.complete_session($1,'completed',$2,$3,$4::jsonb,$5,$6,$7,'{}'::jsonb,$8::jsonb) AS r`,
      [id, 60, 'done', JSON.stringify(REC_A), 120, 0.9, 140, JSON.stringify({ totalPauses: 1 })])).rows[0].r;
    expect(r.success).toBe(true);
    const row = await db.query<{ filler_counts: unknown }>(`SELECT filler_counts FROM public.sessions WHERE id=$1`, [id]);
    expect(row.rows[0].filler_counts).toEqual({}); // persisted as a measured zero, never NULL
  });

  it('has no transcript parameter on the RPC (identity args, transcript-free)', async () => {
    const r = await db.query<{ args: string }>(
      `SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='complete_session'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].args).not.toMatch(/transcript/i);
    expect(r.rows[0].args).toMatch(/p_next_action jsonb/);
    expect(r.rows[0].args).toMatch(/p_pause_metrics jsonb$/);
  });
});
