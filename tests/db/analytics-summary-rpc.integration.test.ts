// @vitest-environment node
//
// #1306 — EXECUTED client↔RPC parity + authorization proof for the REPOINTED get_analytics_summary.
//
// Forward-only clean reset: the analytics RPC now reads the strict FLAT filler_counts (no nested filler_words,
// no transcript_state gate, accuracy series retired). This lean file proves ONLY the load-bearing guarantees
// (the schema-level firewall / prose rejection lives in metrics-only-persistence.integration.test.ts):
//   1. client analytics and the server RPC agree on the SAME flat input (overall stats + top fillers);
//   2. NULL is EXCLUDED (not measured) while `{}` is INCLUDED as a measured zero — both sides agree;
//   3. filler-trend parity, including the minimum-TWO-eligible-measurements gate (1 → none, 2 → trend);
//   4. three or more metrics-only sessions remain available;
//   5. a wrong / unauthenticated identity is rejected (#1096 guard preserved by the redefinition);
//   6. PUBLIC/anon hold no EXECUTE (ACL preserved).
// No `expired` / `not_captured` / `transcript_state` / nested filler_words / transcript fixtures remain.
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calculateOverallStats, calculateTopFillerWords, calculateFillerWordTrends } from '../../frontend/src/lib/analyticsUtils';
import type { PracticeSession } from '../../frontend/src/types/session';

const M = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
const STAGE_A = M('20260816223606_metrics_only_additive_1306.sql');
// #1306 cutover: the analytics RPC repoint to flat filler_counts is ADDITIVE and ships with the cutover (Stage B
// enforcement is not required to make the client↔RPC agree — only the repoint is).
const REPOINT = M('20260817140000_repoint_analytics_summary_flat_1306.sql');

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

// Minimal BEFORE state (mirrors metrics-only-persistence): content columns + auth.uid() = U, then Stage A + B
// give the FINAL metrics-only schema and the repointed get_analytics_summary.
const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
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
    filler_words jsonb, custom_words text, pause_metrics jsonb, status text, status_reason text,
    title text, engine text, engine_version text, model_name text, device_type text, attribution_status text);
  CREATE TABLE public.user_issue_reports (id uuid PRIMARY KEY, user_id uuid, transcript_excerpt text, note text);
  CREATE FUNCTION public.complete_session(p_session_id uuid, p_status text DEFAULT 'completed',
    p_final_transcript text DEFAULT NULL, p_final_duration integer DEFAULT NULL, p_reason text DEFAULT NULL)
    RETURNS jsonb LANGUAGE sql AS $fn$ SELECT jsonb_build_object('overload','old') $fn$;
`;

let seq = 0;
const sid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;

interface Summary {
  overallStats: { avgFillerWordsPerMin: string | null; fillerRateContributorCount: number; totalSessions: number };
  topFillerWords: { word: string; count: number }[];
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

const insertRow = (db: PGlite, r: { duration: number; total_words: number | null; clarity_score?: number | null; filler_counts?: unknown }) =>
  r.filler_counts === undefined
    ? db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words,clarity_score) VALUES ($1,$2,'active',$3,$4,$5)`,
        [sid(), U, r.duration, r.total_words, r.clarity_score ?? null])
    : db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words,clarity_score,filler_counts) VALUES ($1,$2,'active',$3,$4,$5,$6)`,
        [sid(), U, r.duration, r.total_words, r.clarity_score ?? null, JSON.stringify(r.filler_counts)]);

// The client-side equivalent of a seeded row — a metrics-only PracticeSession with FLAT filler_counts.
const clientSession = (over: Partial<PracticeSession>): PracticeSession => ({
  id: sid(), user_id: U, created_at: '2025-01-01T00:00:00Z', duration: 60, ...over,
} as unknown as PracticeSession);

describe('#1306 get_analytics_summary — client↔RPC parity on flat filler_counts', () => {
  let db: PGlite;
  const seedRows = [
    { duration: 60, total_words: 120, clarity_score: 0.9, filler_counts: { um: 3, uh: 1 } },
    { duration: 60, total_words: 120, clarity_score: 0.8, filler_counts: { um: 2, like: 4 } },
  ];

  beforeAll(async () => {
    db = await freshDb();
    for (const r of seedRows) await insertRow(db, r);
  });

  it('1. overall filler-rate statistics agree between the RPC and calculateOverallStats', async () => {
    const rpc = await summaryFor(db, U);
    const client = calculateOverallStats(seedRows.map(r => clientSession(r)));
    // 10 fillers over 2.0 min → 5.0/min — one number, two independent implementations.
    expect(rpc.overallStats.avgFillerWordsPerMin).toBe('5.0');
    expect(client.avgFillerWordsPerMin).toBe('5.0');
    expect(rpc.overallStats.fillerRateContributorCount).toBe(2);
  });

  it('2. top filler words + trend parity (>=2 eligible → a trend), between the RPC and the client', async () => {
    const rpc = await summaryFor(db, U);
    const clientTop = calculateTopFillerWords(seedRows.map(r => clientSession(r)));
    const clientTrends = calculateFillerWordTrends(seedRows.map(r => clientSession(r)));
    // Summed: um=5, like=4, uh=1 → both surface um first and 'like' as runner-up.
    expect(clientTop[0]).toEqual({ word: 'um', count: 5 });
    expect(rpc.topFillerWords[0].word).toBe('um');
    expect(Number(rpc.topFillerWords[0].count)).toBe(5);
    expect(clientTop.map(t => t.word)).toContain('like');
    expect(rpc.topFillerWords.map(t => t.word)).toContain('like');
    // Two eligible measurements → BOTH produce a non-empty trend.
    expect(Object.keys(clientTrends).length).toBeGreaterThan(0);
    expect(Object.keys(rpc.fillerWordTrends).length).toBeGreaterThan(0);
  });

  it('3. the minimum-two-measurements trend gate: ONE eligible session yields NO trend on both sides', async () => {
    const one = await freshDb();
    await insertRow(one, { duration: 60, total_words: 120, filler_counts: { um: 3 } });
    const rpc = await summaryFor(one, U);
    const client = calculateFillerWordTrends([clientSession({ duration: 60, total_words: 120, filler_counts: { um: 3 } })]);
    expect(Object.keys(client).length).toBe(0);
    expect(Object.keys(rpc.fillerWordTrends).length).toBe(0);
  });

  it('4. NULL is EXCLUDED (not measured) while {} is INCLUDED as a measured zero — RPC and client agree', async () => {
    const mix = await freshDb();
    await insertRow(mix, { duration: 60, total_words: 120, filler_counts: { um: 6 } }); // measured
    await insertRow(mix, { duration: 60, total_words: 120, filler_counts: {} });         // measured ZERO
    await insertRow(mix, { duration: 60, total_words: 120, filler_counts: undefined });  // NULL — not measured
    const rpc = await summaryFor(mix, U);
    const client = calculateOverallStats([
      clientSession({ duration: 60, total_words: 120, filler_counts: { um: 6 } }),
      clientSession({ duration: 60, total_words: 120, filler_counts: {} }),
      clientSession({ duration: 60, total_words: 120 }), // filler_counts absent → NULL
    ]);
    // Denominator = the two MEASURED rows (2.0 min); the NULL row is excluded. 6 / 2.0 = 3.0/min.
    expect(rpc.overallStats.avgFillerWordsPerMin).toBe('3.0');
    expect(client.avgFillerWordsPerMin).toBe('3.0');
    expect(rpc.overallStats.fillerRateContributorCount).toBe(2); // {} counts; NULL does not
  });

  it('5. three or more metrics-only sessions remain available (retention regression)', async () => {
    const three = await freshDb();
    await insertRow(three, { duration: 60, total_words: 120, filler_counts: { um: 1 } });
    await insertRow(three, { duration: 60, total_words: 120, filler_counts: { uh: 2 } });
    await insertRow(three, { duration: 60, total_words: 120, filler_counts: {} });
    const rpc = await summaryFor(three, U);
    expect(rpc.overallStats.totalSessions).toBeGreaterThanOrEqual(3);
  });
});

describe('#1306 get_analytics_summary — authorization preserved by the redefined function', () => {
  it('6a. rejects a wrong identity and an unauthenticated caller', async () => {
    const db = await freshDb();
    // auth.uid() = U; requesting OTHER is a foreign read → rejected.
    await expect(summaryFor(db, OTHER)).rejects.toThrow(/Unauthorized/i);
    // Unidentified caller: auth.uid() → NULL.
    await db.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT NULL::uuid $fn$;`);
    await expect(summaryFor(db, U)).rejects.toThrow(/Unauthorized/i);
    await expect(db.query(`SELECT public.get_analytics_summary(NULL)`)).rejects.toThrow(/Unauthorized/i);
  });

  it('6b. EXECUTE ACL: authenticated + service_role granted; anon + PUBLIC revoked', async () => {
    const db = await freshDb();
    const acl = await db.query<{ grantee: string }>(
      `SELECT grantee FROM information_schema.role_routine_grants
       WHERE routine_name = 'get_analytics_summary' AND privilege_type = 'EXECUTE'`,
    );
    const grantees = acl.rows.map(r => r.grantee);
    expect(grantees).toContain('authenticated');
    expect(grantees).toContain('service_role');
    expect(grantees).not.toContain('anon');
    expect(grantees).not.toContain('PUBLIC');
  });
});
