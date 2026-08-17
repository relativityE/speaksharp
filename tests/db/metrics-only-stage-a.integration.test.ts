// @vitest-environment node
//
// #1306 Stage A (ADDITIVE) — EXECUTED proof that the additive migration is backward-compatible and safe to
// deploy BEFORE the application cutover: it adds the nullable metrics-only columns (next_action_signal,
// filler_counts) + a strict shape CHECK, and installs the transcript-FREE complete_session overload WITHOUT
// removing the legacy transcript-accepting overload. No content column is dropped in Stage A. Content-free:
// synthetic strings only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STAGE_A = readFileSync(
  resolve(process.cwd(), 'backend', 'supabase', 'migrations', '20260816223606_metrics_only_additive_1306.sql'),
  'utf8',
);
const U = '11111111-1111-4111-8111-111111111111';

// BEFORE state: the pre-#1306 schema with content columns + the LEGACY transcript-accepting complete_session.
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
  INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${U}', 'pro');
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz,
    transcript text, ai_suggestions jsonb, ground_truth text, accuracy double precision,
    transcript_state text DEFAULT 'not_captured',
    total_words int, duration int, clarity_score double precision, wpm double precision,
    filler_words jsonb, custom_words text, pause_metrics jsonb, status text, status_reason text,
    title text, engine text, engine_version text, model_name text, device_type text, attribution_status text);
  -- Legacy transcript-accepting overload (Stage A must NOT remove it — cutover still depends on it).
  CREATE FUNCTION public.complete_session(p_session_id uuid, p_status text DEFAULT 'completed',
    p_final_transcript text DEFAULT NULL, p_final_duration integer DEFAULT NULL, p_reason text DEFAULT NULL)
    RETURNS jsonb LANGUAGE sql AS $fn$ SELECT jsonb_build_object('overload','old') $fn$;
`;

let seq = 0;
const sid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;
const VALID_REC = JSON.stringify({ reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1' });

async function withA(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(STAGE_A);
  return db;
}
const colN = (db: PGlite, cols: string[]) =>
  db.query<{ n: number }>(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='sessions' AND column_name = ANY($1)`, [cols]);

describe('#1306 Stage A — additive, backward-compatible DB contract', () => {
  it('adds the nullable metrics-only columns without dropping any content column', async () => {
    const db = await withA();
    expect((await colN(db, ['next_action_signal', 'filler_counts'])).rows[0].n).toBe(2);
    // The content columns are UNTOUCHED in Stage A (removal is Stage B only).
    expect((await colN(db, ['transcript', 'ai_suggestions', 'ground_truth', 'accuracy', 'filler_words'])).rows[0].n).toBe(5);
  });

  it('the new metrics-only columns are NULLABLE (existing rows/writers are unaffected)', async () => {
    const db = await withA();
    // A pre-existing-style insert that sets neither new column still succeeds.
    await expect(
      db.query(`INSERT INTO public.sessions (id, user_id, status, duration) VALUES ($1,$2,'active',60)`, [sid(), U]),
    ).resolves.toBeDefined();
  });

  it('installs the transcript-FREE complete_session overload while KEEPING the legacy overload', async () => {
    const db = await withA();
    // Old overload still resolvable (cutover has not happened yet).
    const oldOverload = await db.query<{ r: { overload: string } }>(
      `SELECT public.complete_session($1::uuid, 'completed', NULL, 60, NULL) AS r`, [sid()],
    );
    expect(oldOverload.rows[0].r.overload).toBe('old');
    // New named-parameter (transcript-free) overload exists and is selected by p_next_action.
    const s = sid();
    await db.query(`INSERT INTO public.sessions (id, user_id, status) VALUES ($1,$2,'active')`, [s, U]);
    await expect(
      db.query(`SELECT public.complete_session(p_session_id => $1::uuid, p_status => 'completed', p_next_action => $2::jsonb, p_total_words => 100, p_filler_counts => '{}'::jsonb) AS r`, [s, VALID_REC]),
    ).resolves.toBeDefined();
  });

  it('a completed session requires a measured filler_counts map and a next action (rejects null)', async () => {
    const db = await withA();
    const s = sid();
    await db.query(`INSERT INTO public.sessions (id, user_id, status) VALUES ($1,$2,'active')`, [s, U]);
    // Completed with NULL filler_counts → rejected (never coerced to a fabricated zero).
    await expect(
      db.query(`SELECT public.complete_session(p_session_id => $1::uuid, p_status => 'completed', p_next_action => $2::jsonb, p_total_words => 100) AS r`, [s, VALID_REC]),
    ).rejects.toThrow();
  });
});

// #1306 P1: Stage A must STRICTLY validate filler_counts NOW (not defer to Stage B), or the Stage-A window can
// persist a prose key through the new complete_session RPC. NULL stays allowed (backward compatible). Errors are
// GENERIC and must NEVER echo the rejected key/value.
describe('#1306 Stage A — filler_counts firewall (prose-proof, fail-closed, non-echoing)', () => {
  const PROSE = 'confidential project phrase';
  const insFiller = async (db: PGlite, raw: string | null) =>
    db.query(
      `INSERT INTO public.sessions (id, user_id, status, filler_counts) VALUES ($1,$2,'active',$3::jsonb)`,
      [sid(), U, raw],
    );

  it('ACCEPTS backward-compatible NULL, measured {} and valid approved keys', async () => {
    const db = await withA();
    await expect(insFiller(db, null)).resolves.toBeDefined();
    await expect(insFiller(db, '{}')).resolves.toBeDefined();
    await expect(insFiller(db, JSON.stringify({ um: 3, uh: 0, like: 2 }))).resolves.toBeDefined();
  });

  it('REJECTS unknown/prose keys, nested/array/string, negative, non-integer, and oversized values', async () => {
    const db = await withA();
    await expect(insFiller(db, JSON.stringify({ [PROSE]: 1 }))).rejects.toThrow(/unknown\/custom keys/);
    await expect(insFiller(db, JSON.stringify({ um: { count: 2 } }))).rejects.toThrow(/non-negative finite integers/);
    await expect(insFiller(db, JSON.stringify([1, 2, 3]))).rejects.toThrow(/numeric-keyed object/);
    await expect(insFiller(db, JSON.stringify('um so'))).rejects.toThrow(/numeric-keyed object/);
    await expect(insFiller(db, JSON.stringify({ um: -1 }))).rejects.toThrow(/non-negative finite integers/);
    await expect(insFiller(db, JSON.stringify({ um: 2.5 }))).rejects.toThrow(/non-negative finite integers/);
    await expect(insFiller(db, JSON.stringify({ um: 1000001 }))).rejects.toThrow(/non-negative finite integers/);
  });

  it('the rejection error NEVER echoes the offending prose key or value', async () => {
    const db = await withA();
    let message = '';
    try {
      await insFiller(db, JSON.stringify({ [PROSE]: 1 }));
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/unknown\/custom keys/);
    expect(message).not.toContain(PROSE);
    expect(message).not.toMatch(/confidential/i);
  });

  it('the completion RPC cannot smuggle a prose key either (the trigger fires on the RPC UPDATE)', async () => {
    const db = await withA(); // bootstrap already seeds the pro user_profiles row for U
    const s = sid();
    await db.query(`INSERT INTO public.sessions (id, user_id, status) VALUES ($1,$2,'active')`, [s, U]);
    await expect(
      db.query(
        `SELECT public.complete_session(p_session_id => $1::uuid, p_status => 'completed', p_next_action => $2::jsonb, p_total_words => 100, p_filler_counts => $3::jsonb) AS r`,
        [s, VALID_REC, JSON.stringify({ [PROSE]: 1 })],
      ),
    ).rejects.toThrow(/unknown\/custom keys/);
  });
});
