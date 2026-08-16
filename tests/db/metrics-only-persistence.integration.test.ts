// @vitest-environment node
//
// #1306 — EXECUTED privacy-falsification proof of the FINAL metrics-only schema. Applies Stage A (additive)
// then Stage B (enforcement) on a real PostgreSQL (PGlite) over a production-shaped schema, and asserts the
// content-bearing columns are GONE, the strict recommendation column/constraint stands, and a completed
// session requires a structured next action. Content-free: synthetic strings only, never returned/logged.
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const STAGE_A = M('20260816223606_metrics_only_additive_1306.sql');
const STAGE_B = M('20260816223607_metrics_only_enforcement_1306.sql');

// Production-shaped BEFORE state: the content columns exist; Stage B drops them.
const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $r$;
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz,
    transcript text, ai_suggestions jsonb, ground_truth text, accuracy double precision,
    transcript_state text DEFAULT 'not_captured',
    total_words int, duration int, clarity_score double precision, wpm double precision,
    pause_metrics jsonb, filler_words jsonb,
    status text, status_reason text
  );
  CREATE TABLE public.user_issue_reports (id uuid PRIMARY KEY, user_id uuid, transcript_excerpt text, note text);
`;

const U = '11111111-1111-4111-8111-111111111111';
let seq = 0;
const sid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;
const VALID_REC = JSON.stringify({
  reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate',
  value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1',
});

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(STAGE_A);
  await db.exec(STAGE_B);
  return db;
}
const columnCount = (db: PGlite, table: string, cols: string[]) =>
  db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name = ANY($2)`,
    [table, cols]);

describe('#1306 FINAL metrics-only schema — content columns removed, recommendation enforced', () => {
  let db: PGlite;
  beforeEach(async () => { db = await freshDb(); });

  it('the content-bearing columns are GONE (transcript/ai_suggestions/ground_truth/accuracy + excerpt)', async () => {
    expect((await columnCount(db, 'sessions', ['transcript', 'ai_suggestions', 'ground_truth', 'accuracy'])).rows[0].n).toBe(0);
    expect((await columnCount(db, 'user_issue_reports', ['transcript_excerpt'])).rows[0].n).toBe(0);
    // …and the metrics-only fields plus the structured recommendation remain.
    expect((await columnCount(db, 'sessions', ['recommendation_signals', 'total_words', 'clarity_score', 'wpm', 'pause_metrics'])).rows[0].n).toBe(5);
  });

  it('a write naming a removed content column fails (the field no longer exists)', async () => {
    await expect(db.query(
      `INSERT INTO public.sessions (id, user_id, transcript) VALUES ($1,$2,'um so I think')`, [sid(), U]))
      .rejects.toThrow(/column "transcript" .* does not exist/i);
    await expect(db.query(
      `INSERT INTO public.user_issue_reports (id, user_id, transcript_excerpt) VALUES ($1,$2,'mic did not start')`, [sid(), U]))
      .rejects.toThrow(/column "transcript_excerpt" .* does not exist/i);
  });

  it('a COMPLETED session REQUIRES one structured next action; incomplete/failed may be null', async () => {
    await expect(db.query(
      `INSERT INTO public.sessions (id, user_id, total_words, duration, status, recommendation_signals) VALUES ($1,$2,100,60,'completed',$3)`,
      [sid(), U, VALID_REC])).resolves.toBeDefined();
    await expect(db.query(
      `INSERT INTO public.sessions (id, user_id, total_words, duration, status) VALUES ($1,$2,100,60,'completed')`,
      [sid(), U])).rejects.toThrow(/completed session requires exactly one structured recommendation/);
    await expect(db.query(
      `INSERT INTO public.sessions (id, user_id, total_words, duration, status) VALUES ($1,$2,0,0,'failed')`,
      [sid(), U])).resolves.toBeDefined();
  });

  it('the recommendation CHECK rejects unknown keys and free-form enum values (prose-proof)', async () => {
    const withProse = JSON.stringify({ ...JSON.parse(VALID_REC), what_to_try_next: 'Slow down a touch.' });
    await expect(db.query(
      `INSERT INTO public.sessions (id, user_id, status, recommendation_signals) VALUES ($1,$2,'completed',$3)`,
      [sid(), U, withProse])).rejects.toThrow(/sessions_recommendation_signals_shape/);
    const badEnum = JSON.stringify({ ...JSON.parse(VALID_REC), reasonCode: 'You were a bit unclear' });
    await expect(db.query(
      `INSERT INTO public.sessions (id, user_id, status, recommendation_signals) VALUES ($1,$2,'completed',$3)`,
      [sid(), U, badEnum])).rejects.toThrow(/sessions_recommendation_signals_shape/);
  });

  it('the legacy transcript-accepting complete_session overload is gone; only the transcript-free one remains', async () => {
    const r = await db.query<{ args: string }>(
      `SELECT pg_get_function_identity_arguments(oid) AS args FROM pg_proc WHERE proname='complete_session'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].args).not.toMatch(/transcript/i);
  });
});
