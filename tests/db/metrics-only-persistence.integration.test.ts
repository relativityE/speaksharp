// @vitest-environment node
//
// #1306 — EXECUTED privacy-falsification proof. Applies migration 20260816221054 on a real PostgreSQL (PGlite)
// over a production-shaped `sessions` + `user_issue_reports` schema, then ATTEMPTS to persist content and
// asserts the database REJECTS it fail-closed. Content-free: synthetic strings only, never returned/logged.
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'backend', 'supabase', 'migrations', '20260816221054_metrics_only_persistence_1306.sql'),
  'utf8',
);

// Production-shaped subset: every column the #1306 enforcement references, plus representative metrics.
const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $r$;
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now(),
    transcript text, ai_suggestions jsonb, ground_truth text, accuracy double precision,
    transcript_state text DEFAULT 'not_captured', recommendation_signals jsonb,
    total_words int, duration int, clarity_score double precision, wpm double precision,
    pause_metrics jsonb, filler_words jsonb, custom_words jsonb,
    engine text, engine_version text, model_name text, device_type text,
    status text, status_reason text, attribution_status text
  );
  CREATE TABLE public.user_issue_reports (
    id uuid PRIMARY KEY, user_id uuid, transcript_excerpt text, created_at timestamptz DEFAULT now()
  );
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
  await db.exec(MIGRATION);
  return db;
}
const insertSession = (db: PGlite, cols: string, vals: unknown[]) =>
  db.query(`INSERT INTO public.sessions (id, user_id, total_words, duration, ${cols}) VALUES ($1,$2,100,60,${vals.map((_, i) => `$${i + 3}`).join(',')})`, [sid(), U, ...vals]);

describe('#1306 metrics-only persistence — the database refuses content (fail-closed)', () => {
  let db: PGlite;
  beforeEach(async () => { db = await freshDb(); });

  it('ACCEPTS a metrics-only session (no content) and forces transcript_state=not_captured', async () => {
    await db.query(
      `INSERT INTO public.sessions (id, user_id, total_words, duration, clarity_score, wpm, transcript_state)
       VALUES ($1,$2,120,65,0.9,140,'available')`, [sid(), U]);
    const r = await db.query<{ transcript_state: string }>(`SELECT transcript_state FROM public.sessions LIMIT 1`);
    expect(r.rows[0].transcript_state).toBe('not_captured'); // coerced by the trigger
  });

  it('REJECTS a transcript write', async () => {
    await expect(insertSession(db, 'transcript', ['So, um, I think we should review the plan today.']))
      .rejects.toThrow(/transcript text must not be persisted/);
  });

  it('REJECTS ai_suggestions prose, customer ground_truth, and customer accuracy', async () => {
    await expect(insertSession(db, 'ai_suggestions', [JSON.stringify({ what_to_try_next: 'Slow down and breathe.' })]))
      .rejects.toThrow(/ai_suggestions prose must not be persisted/);
    await expect(insertSession(db, 'ground_truth', ['the quick brown fox']))
      .rejects.toThrow(/ground_truth is benchmark-only/);
    await expect(insertSession(db, 'accuracy', [95.5]))
      .rejects.toThrow(/accuracy has no ground truth/);
  });

  it('cannot smuggle content via UPDATE either (trigger covers INSERT and UPDATE)', async () => {
    await db.query(`INSERT INTO public.sessions (id, user_id, total_words, duration) VALUES ($1,$2,10,10)`, [sid(), U]);
    await expect(db.query(`UPDATE public.sessions SET transcript = 'late-bound transcript' WHERE user_id = $1`, [U]))
      .rejects.toThrow(/transcript text must not be persisted/);
  });

  it('ACCEPTS a valid structured recommendation signal', async () => {
    await expect(insertSession(db, 'recommendation_signals', [VALID_REC])).resolves.toBeDefined();
  });

  it('a COMPLETED session REQUIRES one structured next action; incomplete/failed may be null', async () => {
    // completed + valid recommendation → OK
    await expect(db.query(
      `INSERT INTO public.sessions (id, user_id, total_words, duration, status, recommendation_signals) VALUES ($1,$2,100,60,'completed',$3)`,
      [sid(), U, VALID_REC])).resolves.toBeDefined();
    // completed + NULL recommendation → REJECTED
    await expect(db.query(
      `INSERT INTO public.sessions (id, user_id, total_words, duration, status) VALUES ($1,$2,100,60,'completed')`,
      [sid(), U])).rejects.toThrow(/completed session requires exactly one structured recommendation/);
    // failed / incomplete + NULL recommendation → OK
    await expect(db.query(
      `INSERT INTO public.sessions (id, user_id, total_words, duration, status) VALUES ($1,$2,0,0,'failed')`,
      [sid(), U])).resolves.toBeDefined();
  });

  it('REJECTS a recommendation with an UNKNOWN key (prose cannot be smuggled)', async () => {
    const withProse = JSON.stringify({ ...JSON.parse(VALID_REC), what_to_try_next: 'You spoke a little fast today.' });
    await expect(insertSession(db, 'recommendation_signals', [withProse]))
      .rejects.toThrow(/sessions_recommendation_signals_shape/);
  });

  it('REJECTS a recommendation with a free-form value in an enum field', async () => {
    const badEnum = JSON.stringify({ ...JSON.parse(VALID_REC), reasonCode: 'You were a bit unclear this time' });
    await expect(insertSession(db, 'recommendation_signals', [badEnum]))
      .rejects.toThrow(/sessions_recommendation_signals_shape/);
  });

  it('REJECTS an issue-report transcript excerpt; ACCEPTS an excerpt-free report', async () => {
    await expect(db.query(
      `INSERT INTO public.user_issue_reports (id, user_id, transcript_excerpt) VALUES ($1,$2,$3)`,
      [sid(), U, 'um so the mic did not start'],
    )).rejects.toThrow(/transcript_excerpt must not be persisted/);
    await expect(db.query(
      `INSERT INTO public.user_issue_reports (id, user_id) VALUES ($1,$2)`, [sid(), U],
    )).resolves.toBeDefined();
  });
});
