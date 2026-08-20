// @vitest-environment node
//
// #1314 RETURN 4 — the atomic completion RPC driving the REAL retention coordinator.
//
// The first version of these tests used a STUB coordinator, which proved only that the RPC calls *something*.
// This applies the ACTUAL merged migrations — #1131 transcript_state (20260801000000), R1 newest-two
// (20260803000000) and R2 converge-on-save (20260804000000) — so the genuine newest-two ranking, the Option A
// evidence gating and the bounded expiry mutation are all exercised end to end, then proves a real
// three-session rotation through `complete_session`.
//
// Content-free: synthetic strings only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const M = resolve(process.cwd(), 'backend', 'supabase', 'migrations');
const sql = (f: string) => readFileSync(resolve(M, f), 'utf8');
const BOOTSTRAP = readFileSync(resolve(process.cwd(), 'tests', 'db', 'transcript-retention-converge-bootstrap.sql'), 'utf8');
const M1131 = sql('20260801000000_sessions_transcript_state.sql');
const R1 = sql('20260803000000_transcript_retention_newest_two.sql');
const R2 = sql('20260804000000_transcript_retention_converge_on_save.sql');
const STAGE_A = sql('20260816223606_metrics_only_additive_1306.sql');
const ATOMIC = sql('20260819120000_complete_session_v2_atomic_retention_1314.sql');

const U = '11111111-1111-4111-8111-111111111111';
const REC = JSON.stringify({ reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1' });
const sid = (k: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(k).padStart(12, '0')}`;

// Stage A / the atomic RPC need a tier resolver and a pro profile; the shared bootstrap deliberately keeps
// user_profiles minimal, so extend it here rather than forking the bootstrap.
const EXTRA = `
  ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS subscription_status text,
    ADD COLUMN IF NOT EXISTS trial_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
    ADD COLUMN IF NOT EXISTS subscription_id text,
    ADD COLUMN IF NOT EXISTS commercial_trial_granted_at timestamptz;
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  SELECT set_config('request.jwt.claim.sub', '${U}', false);
`;

async function db0(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(M1131);
  await db.exec(R1);
  await db.exec(R2);
  await db.exec(EXTRA);
  await db.exec(STAGE_A);
  await db.exec(ATOMIC);
  await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [U]);
  await db.query("INSERT INTO public.user_profiles (id, subscription_status) VALUES ($1,'pro') ON CONFLICT DO NOTHING", [U]);
  return db;
}

/** Create an active session dated day N, so newest-two ranking is deterministic. */
async function seed(db: PGlite, k: number, dayN: number) {
  const id = sid(k);
  await db.query(
    `INSERT INTO public.sessions (id, user_id, created_at, status, duration) VALUES ($1,$2,$3,'active',0)`,
    [id, U, new Date(`2026-07-${String(dayN).padStart(2, '0')}T10:00:00Z`).toISOString()]);
  return id;
}

async function complete(db: PGlite, id: string, transcript: string | null) {
  const r = await db.query<{ r: { transcript_outcome?: string; transcript_state?: string; retention?: { status?: string } } }>(
    `SELECT public.complete_session_v2(
p_session_id => $1::uuid, p_status => 'completed', p_final_duration => 60, p_reason => NULL,
       p_next_action => $2::jsonb, p_total_words => 100, p_clarity_score => 80, p_wpm => 120,
       p_filler_counts => '{}'::jsonb, p_pause_metrics => NULL, p_final_transcript => $3::text) AS r`,
    [id, REC, transcript]);
  return r.rows[0].r;
}

/** Option A requires DURABLE TERMINAL Progress evidence before an older transcript may expire. */
async function addTerminalEvidence(db: PGlite, sessionId: string) {
  await db.query(
    `INSERT INTO public.session_progress_evaluations (user_id, session_id, formula_version, attribution_status, eligible)
     VALUES ($1,$2,'clarity_v1','verified',true)`, [U, sessionId]);
}

const stateOf = async (db: PGlite, id: string) =>
  (await db.query<{ transcript_state: string; transcript: string | null; total_words: number | null }>(
    `SELECT transcript_state, transcript, total_words FROM public.sessions WHERE id=$1`, [id])).rows[0];

const retainedCount = async (db: PGlite) =>
  (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.sessions WHERE user_id=$1 AND transcript_state='available'`, [U])).rows[0].n;

describe('#1314 — three-session rotation through the REAL coordinator', () => {
  it('sessions 2 and 3 keep their transcripts, session 1 expires, and session 1 KEEPS its metrics', async () => {
    const db = await db0();

    const s1 = await seed(db, 1, 1);
    expect((await complete(db, s1, 'synthetic session one')).transcript_outcome).toBe('retained');

    const s2 = await seed(db, 2, 2);
    expect((await complete(db, s2, 'synthetic session two')).transcript_outcome).toBe('retained');
    expect(await retainedCount(db)).toBe(2);           // at the promised ceiling, nothing expired yet

    // Option A: session 1 may only expire once its terminal Progress evidence is durable.
    await addTerminalEvidence(db, s1);

    const s3 = await seed(db, 3, 3);
    expect((await complete(db, s3, 'synthetic session three')).transcript_outcome).toBe('retained');

    // The promise holds at exactly two, and it is the OLDEST that gave way.
    expect(await retainedCount(db)).toBe(2);
    expect((await stateOf(db, s2)).transcript).toBe('synthetic session two');
    expect((await stateOf(db, s3)).transcript).toBe('synthetic session three');

    const one = await stateOf(db, s1);
    expect(one.transcript_state).toBe('expired');
    expect(one.transcript).toBeNull();
    // ...and expiring the TEXT must not cost the metrics that feed Progress history.
    expect(one.total_words).toBe(100);
  });

  it('pending evidence does NOT retain a third transcript — #1314 ruling supersedes Option A temp-3', async () => {
    const db = await db0();
    const s1 = await seed(db, 11, 1);
    await complete(db, s1, 'synthetic one');
    const s2 = await seed(db, 12, 2);
    await complete(db, s2, 'synthetic two');
    expect(await retainedCount(db)).toBe(2);

    // No durable Progress evidence for s1 -> the real coordinator returns 'pending'. R1/R2 would temporarily
    // allow a third transcript; the PO's #1314 ruling is stricter (never exceed two), so complete_session_v2
    // must NOT retain the third session's transcript.
    const s3 = await seed(db, 13, 3);
    const res = await complete(db, s3, 'synthetic three');

    expect(res.transcript_outcome).toBe('retention_failed');
    expect(res.transcript_retained).toBe(false);
    expect((await stateOf(db, s3)).transcript).toBeNull();
    expect((await stateOf(db, s1)).transcript_state).toBe('available');
    expect(await retainedCount(db)).toBe(2);                    // never three
    expect((await stateOf(db, s3)).total_words).toBe(100);      // metrics still durable
  });

  it('with durable evidence, a new session retains and the oldest expires — stays at two', async () => {
    const db = await db0();
    const s1 = await seed(db, 21, 1);
    await complete(db, s1, 'synthetic one');
    const s2 = await seed(db, 22, 2);
    await complete(db, s2, 'synthetic two');
    await addTerminalEvidence(db, s1);                  // s1 terminal Progress evidence is durable

    const s3 = await seed(db, 23, 3);
    const res = await complete(db, s3, 'synthetic three');

    expect(res.transcript_outcome).toBe('retained');   // convergence succeeded -> the new transcript is kept
    expect((await stateOf(db, s1)).transcript_state).toBe('expired');
    expect(await retainedCount(db)).toBe(2);
  });
});
