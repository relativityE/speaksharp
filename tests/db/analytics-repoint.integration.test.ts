// @vitest-environment node
//
// #1306 Stage A (additive) — EXECUTED proof of the get_analytics_summary REPOINT to flat filler_counts.
//
// This validates the repoint migration on its own (self-contained: expected values are hand-computed, NO client
// import — the client↔RPC PARITY proof lives in the cutover PR, where the flat analytics client exists). Proves:
//   1. flat filler_counts aggregation (avg filler/min + top words), accuracy series retired;
//   2. NULL excluded (not measured) vs `{}` included (measured zero);
//   3. the >=2-eligible filler-trend gate;
//   4. #1096 authorization preserved (null / foreign identity rejected; PUBLIC/anon EXECUTE revoked).
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const STAGE_A = M('20260816223606_metrics_only_additive_1306.sql');
const REPOINT = M('20260817140000_repoint_analytics_summary_flat_1306.sql');
const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
let seq = 0;
const sid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;

const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  END $r$;
  CREATE SCHEMA IF NOT EXISTS auth;
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
    filler_words jsonb, custom_words text, pause_metrics jsonb, status text, status_reason text,
    title text, engine text, engine_version text, model_name text, device_type text, attribution_status text);
`;

interface Summary {
  overallStats: { avgFillerWordsPerMin: string | null; fillerRateContributorCount: number; totalSessions: number };
  topFillerWords: { word: string; count: number }[];
  accuracyData: unknown[];
  fillerWordTrends: Record<string, unknown>;
}
async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(STAGE_A);
  await db.exec(REPOINT);
  return db;
}
const summaryFor = async (db: PGlite, forUser: string): Promise<Summary> =>
  (await db.query<{ s: Summary }>(`SELECT public.get_analytics_summary($1) AS s`, [forUser])).rows[0].s;
const insert = (db: PGlite, filler: unknown, tw: number | null = 120) =>
  filler === undefined
    ? db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words) VALUES ($1,$2,'active',60,$3)`, [sid(), U, tw])
    : db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words,filler_counts) VALUES ($1,$2,'active',60,$3,$4)`, [sid(), U, tw, JSON.stringify(filler)]);

describe('#1306 get_analytics_summary repoint — flat filler_counts aggregation', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb();
    await insert(db, { um: 3, uh: 1 });   // 4
    await insert(db, { um: 2, like: 4 }); // 6
  });

  it('aggregates flat counts: 10 fillers / 2.0 min = 5.0/min; top word um(5), like present; accuracy retired', async () => {
    const r = await summaryFor(db, U);
    expect(r.overallStats.avgFillerWordsPerMin).toBe('5.0');
    expect(r.overallStats.fillerRateContributorCount).toBe(2);
    expect(r.topFillerWords[0].word).toBe('um');
    expect(Number(r.topFillerWords[0].count)).toBe(5);
    expect(r.topFillerWords.map(t => t.word)).toContain('like');
    expect(r.accuracyData).toEqual([]);
    expect(Object.keys(r.fillerWordTrends).length).toBeGreaterThan(0); // 2 eligible → a trend
  });

  it('NULL is EXCLUDED (not measured); {} is INCLUDED (measured zero)', async () => {
    const mix = await freshDb();
    await insert(mix, { um: 6 }); // measured
    await insert(mix, {});        // measured zero
    await insert(mix, undefined); // NULL — not measured
    const r = await summaryFor(mix, U);
    expect(r.overallStats.avgFillerWordsPerMin).toBe('3.0'); // 6 / 2.0 measured min
    expect(r.overallStats.fillerRateContributorCount).toBe(2);
  });

  it('the >=2-eligible trend gate: ONE eligible session yields NO trend', async () => {
    const one = await freshDb();
    await insert(one, { um: 3 });
    const r = await summaryFor(one, U);
    expect(Object.keys(r.fillerWordTrends).length).toBe(0);
  });
});

describe('#1306 get_analytics_summary repoint — authorization preserved', () => {
  it('rejects a wrong identity and an unauthenticated caller', async () => {
    const db = await freshDb();
    await expect(summaryFor(db, OTHER)).rejects.toThrow(/Unauthorized/i);
    await db.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT NULL::uuid $fn$;`);
    await expect(summaryFor(db, U)).rejects.toThrow(/Unauthorized/i);
  });

  it('EXECUTE ACL: authenticated + service_role granted; anon + PUBLIC revoked', async () => {
    const db = await freshDb();
    const acl = await db.query<{ grantee: string }>(
      `SELECT grantee FROM information_schema.role_routine_grants
       WHERE routine_name = 'get_analytics_summary' AND privilege_type = 'EXECUTE'`);
    const g = acl.rows.map(r => r.grantee);
    expect(g).toContain('authenticated');
    expect(g).toContain('service_role');
    expect(g).not.toContain('anon');
    expect(g).not.toContain('PUBLIC');
  });
});

// #1306 P1 defense-in-depth: even if a prose key somehow slipped into the table (before the firewall, or via a
// privileged path), the repointed analytics must NEVER surface it — not in the total/rate, not as a top word.
describe('#1306 get_analytics_summary repoint — fail-closed defense in depth (a malformed row is EXCLUDED WHOLESALE)', () => {
  it('a prose-only OR mixed valid+prose row (trigger-bypassed) never affects total, denominator, rate, trend, or top words', async () => {
    const db = await freshDb();
    const PROSE = 'confidential project phrase';
    // A genuinely-valid measured row.
    await db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words,filler_counts) VALUES ($1,$2,'active',60,120,$3)`,
      [sid(), U, JSON.stringify({ um: 6 })]);
    // Bypass the Stage-A firewall to simulate pre-firewall / privileged malformed rows.
    await db.exec(`ALTER TABLE public.sessions DISABLE TRIGGER validate_filler_counts_1306;`);
    await db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words,filler_counts) VALUES ($1,$2,'active',60,120,$3)`,
      [sid(), U, JSON.stringify({ um: 2, [PROSE]: 5 })]);  // MIXED valid+prose → malformed → NULL (excluded)
    await db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words,filler_counts) VALUES ($1,$2,'active',60,120,$3)`,
      [sid(), U, JSON.stringify({ [PROSE]: 9 })]);           // PROSE-ONLY → malformed → NULL (excluded)
    await db.exec(`ALTER TABLE public.sessions ENABLE TRIGGER validate_filler_counts_1306;`);

    const r = await summaryFor(db, U);
    // ONLY the valid row measures: 6 fillers over 1.0 min → 6.0/min; exactly ONE contributor (the malformed
    // rows are unavailable, not partial). The mixed row's um(2) is NOT partially counted.
    expect(r.overallStats.avgFillerWordsPerMin).toBe('6.0');
    expect(r.overallStats.fillerRateContributorCount).toBe(1);
    expect(r.topFillerWords.map(t => t.word)).toEqual(['um']);
    expect(Number(r.topFillerWords[0].count)).toBe(6); // only the valid row's um, never the mixed row's um(2)
    expect(JSON.stringify(r)).not.toContain(PROSE);
  });
});
