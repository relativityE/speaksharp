// @vitest-environment node
//
// #1306 — EXECUTED proof of the FINAL metrics-only schema (Stage A + Stage B) on real PostgreSQL (PGlite):
// content columns removed (no CASCADE); the next action contract enforced; a content-free preflight fails
// closed on legacy completed rows lacking a next action; unrelated schema (RPCs, views, RLS policies,
// tables) survives Stage B; and named-parameter RPC routing selects the new overload in Stage A and the old
// overload is absent after Stage B. Content-free: synthetic strings only.
import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Cross-layer parity: drive the DB firewall with the SAME approved-key allowlist the client uses.
import { APPROVED_FILLER_KEYS } from '../../frontend/src/contracts/fillerCounts';

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
  it('drops the content + loose-JSON columns (no CASCADE) and keeps the metrics + next-action columns', async () => {
    const db = await withAB();
    expect((await colN(db, 'sessions', ['transcript', 'ai_suggestions', 'ground_truth', 'accuracy'])).rows[0].n).toBe(0);
    expect((await colN(db, 'user_issue_reports', ['transcript_excerpt'])).rows[0].n).toBe(0);
    // The loosely-typed filler tally and per-session custom words are gone (replaced by strict filler_counts /
    // moved to account-level preference storage).
    expect((await colN(db, 'sessions', ['filler_words', 'custom_words'])).rows[0].n).toBe(0);
    expect((await colN(db, 'sessions', ['next_action_signal', 'total_words', 'clarity_score', 'wpm', 'filler_counts', 'pause_metrics'])).rows[0].n).toBe(6);
  });

  it('a write naming a removed content column fails (the field no longer exists)', async () => {
    const db = await withAB();
    await expect(db.query(`INSERT INTO public.sessions (id, user_id, transcript) VALUES ($1,$2,'um so')`, [sid(), U]))
      .rejects.toThrow(/column "transcript" .* does not exist/i);
  });

  it('the next action CHECK stays prose-proof and completed requires a next action', async () => {
    const db = await withAB();
    await expect(db.query(`INSERT INTO public.sessions (id, user_id, status) VALUES ($1,$2,'completed')`, [sid(), U]))
      .rejects.toThrow(/completed session requires exactly one structured next action/);
    await expect(db.query(`INSERT INTO public.sessions (id, user_id, status, next_action_signal) VALUES ($1,$2,'completed',$3)`, [sid(), U, VALID_REC]))
      .resolves.toBeDefined();
    const prose = JSON.stringify({ ...JSON.parse(VALID_REC), what_to_try_next: 'slow down' });
    await expect(db.query(`INSERT INTO public.sessions (id, user_id, status, next_action_signal) VALUES ($1,$2,'active',$3)`, [sid(), U, prose]))
      .rejects.toThrow(/sessions_next_action_signal_shape/);
  });

  it('UNRELATED schema survives Stage B (no CASCADE collateral): table, view, function, RLS policy', async () => {
    const db = await withAB();
    expect(await objExists(db, `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='keep_me'`)).toBe(1);
    expect(await objExists(db, `SELECT count(*)::int AS n FROM information_schema.views WHERE table_schema='public' AND table_name='keep_view'`)).toBe(1);
    expect(await objExists(db, `SELECT count(*)::int AS n FROM pg_proc WHERE proname='keep_fn'`)).toBe(1);
    expect(await objExists(db, `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='keep_me' AND policyname='keep_policy'`)).toBe(1);
  });
});

// Three-session RETENTION REGRESSION guard: the retired "keep only the newest two transcripts" mechanism must
// never re-appear as row deletion. Users may hold ANY number of metrics-only records; three is simply the
// smallest count that would expose an oldest-row deletion. Not a product limit.
describe('#1306 three-session retention regression (retired newest-two must not delete older rows)', () => {
  it('keeps all THREE completed metrics-only sessions + their metrics after Stage B', async () => {
    const db = await withA();
    const ids = [sid(), sid(), sid()];
    for (let i = 0; i < ids.length; i++) {
      await db.query(
        `INSERT INTO public.sessions (id, user_id, status, next_action_signal, total_words, clarity_score, wpm, filler_counts, pause_metrics)
         VALUES ($1,$2,'completed',$3,$4,$5,$6,$7,$8)`,
        [ids[i], U, VALID_REC, 100 + i, 0.9, 130 + i, JSON.stringify({ um: i }), JSON.stringify({ totalPauses: i })]);
    }
    await db.exec(STAGE_B);
    // All three rows survive — nothing deletes or selects the oldest session.
    const rows = await db.query<{ total_words: number }>(
      `SELECT total_words FROM public.sessions WHERE user_id=$1 ORDER BY total_words`, [U]);
    expect(rows.rows.map(r => r.total_words)).toEqual([100, 101, 102]);
    // …and every surviving row is content-free (no transcript/loose-JSON columns remain).
    expect((await colN(db, 'sessions', ['transcript', 'ai_suggestions', 'ground_truth', 'accuracy', 'filler_words', 'custom_words'])).rows[0].n).toBe(0);
  });
});

// FALSIFICATION: attempt to smuggle prose/arbitrary JSON through EACH retained TEXT/JSONB session field after
// the Stage-B firewall is installed. Every attempt must be rejected; a strict-shape row still inserts.
describe('#1306 field-level prose firewall (Stage B) — no retained field accepts prose/arbitrary JSON', () => {
  const insFiller = (db: PGlite, val: string) =>
    db.query(`INSERT INTO public.sessions (id,user_id,status,filler_counts) VALUES ($1,$2,'active',$3)`, [sid(), U, val]);
  const insPause = (db: PGlite, val: string) =>
    db.query(`INSERT INTO public.sessions (id,user_id,status,pause_metrics) VALUES ($1,$2,'active',$3)`, [sid(), U, val]);

  it('filler_counts rejects custom keys, string/array/nested/negative values', async () => {
    const db = await withAB();
    await expect(insFiller(db, JSON.stringify({ 'I rambled about my weekend': 3 }))).rejects.toThrow(/filler_counts has unknown\/custom keys/);
    await expect(insFiller(db, JSON.stringify({ um: 'lots and lots' }))).rejects.toThrow(/filler_counts values must be non-negative finite/);
    await expect(insFiller(db, JSON.stringify({ um: { count: 2, note: 'prose' } }))).rejects.toThrow(/filler_counts values must be non-negative finite/);
    await expect(insFiller(db, JSON.stringify({ um: -1 }))).rejects.toThrow(/filler_counts values must be non-negative finite/);
    await expect(insFiller(db, JSON.stringify([1, 2, 3]))).rejects.toThrow(/filler_counts must be a numeric-keyed object/);
  });

  it('pause_metrics rejects unknown keys and non-numeric values', async () => {
    const db = await withAB();
    await expect(insPause(db, JSON.stringify({ coach_note: 'slow down and breathe' }))).rejects.toThrow(/pause_metrics has unknown keys/);
    await expect(insPause(db, JSON.stringify({ totalPauses: 'a lot' }))).rejects.toThrow(/pause_metrics values must be non-negative finite/);
  });

  it('status_reason rejects free-form text (reason code or null only)', async () => {
    const db = await withAB();
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status,status_reason) VALUES ($1,$2,'failed','I got distracted and told a story')`, [sid(), U]))
      .rejects.toThrow(/status_reason must be a known reason code/);
  });

  it('status rejects values outside the lifecycle enum', async () => {
    const db = await withAB();
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status) VALUES ($1,$2,'my rambling notes')`, [sid(), U]))
      .rejects.toThrow(/status must be one of/);
  });

  it('app-set text fields are structurally constrained (prose/free-form rejected)', async () => {
    const db = await withAB();
    const prose = 'So today I talked about my trip.\nThen I rambled for a while about the weather.';
    // title: only the exact app-generated ISO format; free-form/locale/prose rejected.
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status,title) VALUES ($1,$2,'active',$3)`, [sid(), U, prose]))
      .rejects.toThrow(/title must be the app-generated/);
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status,title) VALUES ($1,$2,'active','8/16/2026, 7:30:00 PM um so')`, [sid(), U]))
      .rejects.toThrow(/title must be the app-generated/);
    // engine / device_type: exact enums (a plausible-looking free-form value is still rejected).
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status,engine) VALUES ($1,$2,'active','the words I said')`, [sid(), U]))
      .rejects.toThrow(/engine must be one of/);
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status,device_type) VALUES ($1,$2,'active','my laptop and I rambled')`, [sid(), U]))
      .rejects.toThrow(/device_type must be one of/);
    // engine_version / model_name: strict machine tokens (spaces/prose rejected — no room for a phrase).
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status,engine_version) VALUES ($1,$2,'active','whisper but slower today')`, [sid(), U]))
      .rejects.toThrow(/engine_version must be a machine token/);
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status,model_name) VALUES ($1,$2,'active',$3)`, [sid(), U, prose]))
      .rejects.toThrow(/model_name must be a machine token/);
    // known-set enums.
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status,attribution_status) VALUES ($1,$2,'active','I think it was private')`, [sid(), U]))
      .rejects.toThrow(/attribution_status must be a known code/);
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status,transcript_state) VALUES ($1,$2,'active','the words I said')`, [sid(), U]))
      .rejects.toThrow(/transcript_state must be a known code/);
  });

  it('a strict-shape metrics-only row still inserts (positive control)', async () => {
    const db = await withAB();
    await expect(db.query(
      `INSERT INTO public.sessions (id,user_id,status,status_reason,filler_counts,pause_metrics,next_action_signal,title,engine,engine_version,model_name,device_type,attribution_status,transcript_state)
       VALUES ($1,$2,'completed','user_stopped',$3,$4,$5,'Session 2026-08-16T19:30:00.000Z','private','transformers-js','Xenova/whisper-base.en','browser','verified','not_captured')`,
      [sid(), U, JSON.stringify({ um: 2, uh: 1 }), JSON.stringify({ totalPauses: 3, averagePauseDuration: 0.4 }), VALID_REC]))
      .resolves.toBeDefined();
  });
});

// The analytics RPC is REPOINTED to the strict flat filler_counts (no filler_words, no transcript_state gate,
// accuracy series retired). Prove it aggregates the flat shape correctly after Stage B.
describe('#1306 get_analytics_summary repointed to flat filler_counts (forward-only clean reset)', () => {
  it('aggregates flat counts (top words + filler rate), retires the accuracy series, still computes trends', async () => {
    const db = await withAB();
    // Two eligible metrics-only sessions, 60s each, flat standard-key filler_counts.
    await db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words,clarity_score,filler_counts) VALUES ($1,$2,'active',60,120,0.9,$3)`,
      [sid(), U, JSON.stringify({ um: 3, uh: 1 })]);
    await db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words,clarity_score,filler_counts) VALUES ($1,$2,'active',60,120,0.8,$3)`,
      [sid(), U, JSON.stringify({ um: 2, like: 4 })]);
    const r = (await db.query<{ s: {
      topFillerWords: { word: string; count: number }[];
      accuracyData: unknown[];
      overallStats: { avgFillerWordsPerMin: string; fillerRateContributorCount: number };
      fillerWordTrends: Record<string, unknown>;
    } }>(`SELECT public.get_analytics_summary($1) AS s`, [U])).rows[0].s;
    // Summed across rows: um=5, like=4, uh=1 → top 2 = um(5), like(4).
    expect(r.topFillerWords[0].word).toBe('um');
    expect(Number(r.topFillerWords[0].count)).toBe(5);
    expect(r.topFillerWords.map(t => t.word)).toContain('like');
    // 10 fillers over 2.0 min → 5.0/min; both rows are filler contributors.
    expect(r.overallStats.avgFillerWordsPerMin).toBe('5.0');
    expect(r.overallStats.fillerRateContributorCount).toBe(2);
    // STT-accuracy series retired with the accuracy column.
    expect(r.accuracyData).toEqual([]);
    // Two eligible measurements → trends computed (non-empty).
    expect(Object.keys(r.fillerWordTrends).length).toBeGreaterThan(0);
  });

  it('zero-vs-missing: {} counts as a measured zero (in the denominator); NULL is excluded', async () => {
    const db = await withAB();
    // Row A: 60s, 6 fillers. Row B: 60s, measured ZERO ({}). Row C: 60s, filler NOT measured (NULL).
    await db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words,filler_counts) VALUES ($1,$2,'active',60,120,$3)`, [sid(), U, JSON.stringify({ um: 6 })]);
    await db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words,filler_counts) VALUES ($1,$2,'active',60,120,'{}')`, [sid(), U]);
    await db.query(`INSERT INTO public.sessions (id,user_id,status,duration,total_words) VALUES ($1,$2,'active',60,120)`, [sid(), U]); // filler_counts NULL
    const r = (await db.query<{ s: { overallStats: { avgFillerWordsPerMin: string; fillerRateContributorCount: number } } }>(
      `SELECT public.get_analytics_summary($1) AS s`, [U])).rows[0].s;
    // Denominator = A + B (the two MEASURED rows = 2.0 min); NULL row C excluded. 6 fillers / 2.0 min = 3.0/min.
    expect(r.overallStats.avgFillerWordsPerMin).toBe('3.0');
    expect(r.overallStats.fillerRateContributorCount).toBe(2); // {} counts as a contributor; NULL does not
  });
});

// ALLOWLIST PARITY (client ↔ DB): drive the DB firewall with the client's own APPROVED_FILLER_KEYS. If the two
// lists ever drift, an approved key would be rejected (or an unapproved one accepted) and this fails.
describe('#1306 filler allowlist parity — DB enforces EXACTLY the client-approved keys, no prose leak', () => {
  it('accepts every client-approved key and rejects an unknown key (generic, no key echoed)', async () => {
    const db = await withAB();
    expect(APPROVED_FILLER_KEYS.length).toBe(13);
    // Every approved key persists together (distinct nonzero counts).
    const allApproved = Object.fromEntries(APPROVED_FILLER_KEYS.map((k, i) => [k, i + 1]));
    await expect(db.query(`INSERT INTO public.sessions (id,user_id,status,filler_counts) VALUES ($1,$2,'active',$3)`, [sid(), U, JSON.stringify(allApproved)]))
      .resolves.toBeDefined();
    // An unknown prose key is rejected — and the DB error is generic (never echoes the offending phrase).
    const PROSE = 'a confidential secret phrase';
    await db.query(`INSERT INTO public.sessions (id,user_id,status,filler_counts) VALUES ($1,$2,'active',$3)`, [sid(), U, JSON.stringify({ [PROSE]: 1 })])
      .then(() => { throw new Error('expected rejection'); })
      .catch((e: Error) => {
        expect(e.message).toMatch(/filler_counts has unknown\/custom keys/);
        expect(e.message).not.toContain(PROSE); // no-leak: the phrase is never in the DB error
      });
  });
});

describe('#1306 Stage B content-free preflight — fails closed on legacy completed rows without a next action', () => {
  it('FAILS Stage B if a completed row lacks next_action_signal (counts only, never reads content)', async () => {
    const db = await withA();
    await db.query(`INSERT INTO public.sessions (id, user_id, status, total_words) VALUES ($1,$2,'completed',10)`, [sid(), U]); // legacy canary/test row
    await expect(db.exec(STAGE_B)).rejects.toThrow(/Stage B preflight: .* completed session row\(s\) lack next_action_signal/);
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
  it('Stage A: a call with p_next_action selects the NEW overload; p_final_transcript selects the OLD', async () => {
    const db = await withA();
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [U]);
    await db.query(`INSERT INTO public.user_profiles (id, subscription_status) VALUES ($1,'pro')`, [U]);
    const s = sid();
    await db.query(`INSERT INTO public.sessions (id, user_id, status, duration) VALUES ($1,$2,'active',30)`, [s, U]);
    // Named p_next_action → NEW overload runs (returns final_status), not the old stub.
    const neu = (await db.query<{ r: { final_status?: string; overload?: string } }>(
      `SELECT public.complete_session(p_session_id => $1::uuid, p_status => 'completed', p_next_action => $2::jsonb, p_total_words => 100, p_filler_counts => '{}'::jsonb) AS r`, [s, VALID_REC])).rows[0].r;
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
