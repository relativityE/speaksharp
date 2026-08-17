// @vitest-environment node
//
// #1306 aggregate-only preflight — EXECUTED proof that metrics_only_stage_b_readiness() reports readiness
// from COUNTS + column names only (never content), is read-only, and is service_role-only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFLIGHT = readFileSync(
  resolve(process.cwd(), 'backend', 'supabase', 'migrations', '20260817130000_metrics_only_stage_b_preflight_1306.sql'),
  'utf8',
);
const U = '11111111-1111-4111-8111-111111111111';
let seq = 0;
const sid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    DO $r$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    END $r$;
    -- Pre-Stage-B schema: content columns + next_action_signal still present.
    CREATE TABLE public.sessions (id uuid PRIMARY KEY, user_id uuid, status text, next_action_signal jsonb,
      transcript text, ai_suggestions jsonb, ground_truth text, accuracy double precision,
      filler_words jsonb, custom_words text, transcript_state text);
  `);
  await db.exec(PREFLIGHT);
  return db;
}
const readiness = async (db: PGlite) =>
  (await db.query<{ r: { ready: boolean; completed_without_next_action: number; content_columns_remaining: string[] } }>(
    `SELECT public.metrics_only_stage_b_readiness() AS r`)).rows[0].r;

describe('#1306 metrics_only_stage_b_readiness — aggregate-only, content-free', () => {
  it('ready=true when no completed row is missing its next action', async () => {
    const db = await freshDb();
    await db.query(`INSERT INTO public.sessions (id,user_id,status,next_action_signal) VALUES ($1,$2,'completed','{}'::jsonb)`, [sid(), U]);
    const r = await readiness(db);
    expect(r.ready).toBe(true);
    expect(Number(r.completed_without_next_action)).toBe(0);
    // Reports the content columns still present (schema metadata) so the operator knows Stage B has work to do.
    expect(r.content_columns_remaining).toEqual(expect.arrayContaining(['transcript', 'custom_words']));
  });

  it('ready=false with a COUNT (never content) when a completed row lacks its next action', async () => {
    const db = await freshDb();
    await db.query(`INSERT INTO public.sessions (id,user_id,status,next_action_signal,transcript) VALUES ($1,$2,'completed',NULL,'secret words')`, [sid(), U]);
    await db.query(`INSERT INTO public.sessions (id,user_id,status,next_action_signal) VALUES ($1,$2,'completed',NULL)`, [sid(), U]);
    const r = await readiness(db);
    expect(r.ready).toBe(false);
    expect(Number(r.completed_without_next_action)).toBe(2);
    // The verdict is content-free — the offending row's transcript text never appears.
    expect(JSON.stringify(r)).not.toContain('secret words');
  });

  it('EXECUTE is service_role-only (authenticated/anon/PUBLIC revoked)', async () => {
    const db = await freshDb();
    const acl = await db.query<{ grantee: string }>(
      `SELECT grantee FROM information_schema.role_routine_grants
       WHERE routine_name = 'metrics_only_stage_b_readiness' AND privilege_type = 'EXECUTE'`,
    );
    const grantees = acl.rows.map(r => r.grantee);
    expect(grantees).toContain('service_role');
    expect(grantees).not.toContain('authenticated');
    expect(grantees).not.toContain('anon');
    expect(grantees).not.toContain('PUBLIC');
  });
});
