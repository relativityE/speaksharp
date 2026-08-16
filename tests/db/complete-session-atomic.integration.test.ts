// @vitest-environment node
//
// #1306 — RPC-LEVEL proof that `complete_session` (a) never accepts transcript content, (b) writes final
// metrics + exactly ONE structured recommendation ATOMICALLY, (c) rolls the ENTIRE completion back on a
// missing/invalid recommendation, and (d) is idempotent on retry (never creates/changes a second
// recommendation). Real PostgreSQL (PGlite) with a minimal auth.uid()/tier bootstrap + the #1306 migration.
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Stage A (additive) is what the metrics-only frontend calls; the RPC contract is fully testable from A alone.
const MIGRATION = readFileSync(
  resolve(process.cwd(), 'backend', 'supabase', 'migrations', '20260816223606_metrics_only_additive_1306.sql'),
  'utf8',
);
const U = '11111111-1111-4111-8111-111111111111';

const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $r$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT '${U}'::uuid $fn$;
  CREATE TABLE public.user_profiles (
    id uuid PRIMARY KEY, subscription_status text, trial_expires_at timestamptz,
    stripe_subscription_id text, subscription_id text, commercial_trial_granted_at timestamptz
  );
  -- Stub the entitlement resolver to 'pro' so completion proceeds (tier logic is tested elsewhere).
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz,
    transcript text, ai_suggestions jsonb, ground_truth text, accuracy double precision,
    transcript_state text DEFAULT 'not_captured',
    total_words int, duration int, clarity_score double precision, wpm double precision,
    status text, status_reason text
  );
  CREATE TABLE public.user_issue_reports (id uuid PRIMARY KEY, user_id uuid, transcript_excerpt text);
`;

const VALID_A = { reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1' };
const VALID_B = { reasonCode: 'ON_TRACK', actionCode: 'MAINTAIN', metric: 'none', value: 0, comparator: 'within_target', templateVersion: 'rec_v1' };
const INVALID = { ...VALID_A, what_to_try_next: 'Slow down a touch next time.' };

let seq = 0;
const sid = () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++seq).padStart(12, '0')}`;

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(MIGRATION);
  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [U]);
  await db.query(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ($1,'pro')`, [U]);
  return db;
}
async function seedActive(db: PGlite): Promise<string> {
  const id = sid();
  await db.query(`INSERT INTO public.sessions (id, user_id, status, duration, total_words) VALUES ($1,$2,'active',30,50)`, [id, U]);
  return id;
}
const complete = (db: PGlite, id: string, rec: unknown, duration = 60, reason = 'done') =>
  db.query<{ r: { success: boolean; final_status?: string; idempotent?: boolean; recommendation_signals?: unknown } }>(
    `SELECT public.complete_session($1,'completed',$2,$3,$4::jsonb) AS r`,
    [id, duration, reason, rec === undefined ? null : JSON.stringify(rec)]);
const statusOf = async (db: PGlite, id: string) =>
  (await db.query<{ status: string; recommendation_signals: unknown }>(`SELECT status, recommendation_signals FROM public.sessions WHERE id=$1`, [id])).rows[0];

describe('#1306 complete_session — atomic completion + recommendation, fail-closed, idempotent', () => {
  let db: PGlite;
  beforeEach(async () => { db = await freshDb(); });

  it('writes final metrics + exactly one recommendation atomically on success', async () => {
    const id = await seedActive(db);
    const r = (await complete(db, id, VALID_A)).rows[0].r;
    expect(r.success).toBe(true);
    const row = await statusOf(db, id);
    expect(row.status).toBe('completed');
    expect(row.recommendation_signals).toEqual(VALID_A);
  });

  it('ROLLS BACK the entire completion when the recommendation is MISSING', async () => {
    const id = await seedActive(db);
    await expect(complete(db, id, undefined)).rejects.toThrow(/completed session requires exactly one structured recommendation/);
    const row = await statusOf(db, id);
    expect(row.status).toBe('active');            // not marked completed
    expect(row.recommendation_signals).toBeNull(); // nothing attached
  });

  it('ROLLS BACK the entire completion when the recommendation is INVALID (prose smuggled)', async () => {
    const id = await seedActive(db);
    await expect(complete(db, id, INVALID)).rejects.toThrow(/sessions_recommendation_signals_shape/);
    const row = await statusOf(db, id);
    expect(row.status).toBe('active');
    expect(row.recommendation_signals).toBeNull();
  });

  it('IDENTICAL replay is a no-op success (idempotent)', async () => {
    const id = await seedActive(db);
    await complete(db, id, VALID_A);
    const replay = (await complete(db, id, VALID_A)).rows[0].r; // same status/duration/reason/recommendation
    expect(replay.success).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(replay.recommendation_signals).toEqual(VALID_A);
  });

  it('MISMATCHED replay RAISES an idempotency conflict and changes nothing (no partial update)', async () => {
    const id = await seedActive(db);
    await complete(db, id, VALID_A);
    await expect(complete(db, id, VALID_B)).rejects.toThrow(/idempotency conflict/);        // different recommendation
    await expect(complete(db, id, VALID_A, 90)).rejects.toThrow(/idempotency conflict/);     // different duration
    await expect(complete(db, id, VALID_A, 60, 'other')).rejects.toThrow(/idempotency conflict/); // different reason
    const row = await statusOf(db, id);
    expect(row.status).toBe('completed');
    expect(row.recommendation_signals).toEqual(VALID_A); // first completion is untouched
  });

  it('has no transcript parameter — exactly one complete_session with identity args (uuid,text,integer,text,jsonb)', async () => {
    const r = await db.query<{ args: string }>(
      `SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='complete_session'`);
    expect(r.rows.length).toBe(1); // no lingering transcript-accepting overload
    expect(r.rows[0].args).not.toMatch(/transcript/i); // no transcript parameter of any kind
    expect(r.rows[0].args).toMatch(/p_recommendation jsonb$/); // completion takes the structured recommendation
  });
});
