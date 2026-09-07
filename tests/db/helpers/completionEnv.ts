// Shared real-PostgreSQL (PGlite) environment for the atomic-completion boundary.
//
// Extracted from atomic-completion-retention.integration.test.ts so a SECOND suite can exercise the SAME
// schema, the SAME migrations and the SAME completion call. Two hand-built copies of this bootstrap would
// drift, and a drifted copy proves whatever it drifted into rather than what production runs.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'backend', 'supabase', 'migrations', f), 'utf8');
export const STAGE_A = MIG('20260816223606_metrics_only_additive_1306.sql');
export const ATOMIC = MIG('20260819120000_complete_session_v2_atomic_retention_1314.sql');

export const U = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';

let seq = 0;
export const sid = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;
export const REC = JSON.stringify({ reasonCode: 'HIGH_FILLER_RATE', actionCode: 'REDUCE_FILLERS', metric: 'filler_rate', value: 0.08, comparator: 'above_baseline', templateVersion: 'rec_v1' });

// Pre-#1314 schema, including the server-owned transcript_state trigger + its invariants (from
// 20260801000000) and a stub retention coordinator whose behaviour each test can steer.
export const BOOTSTRAP = `
  DO $r$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $r$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TABLE public.auth_ctx (uid uuid);
  INSERT INTO public.auth_ctx VALUES ('${U}');
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT uid FROM public.auth_ctx LIMIT 1 $fn$;
  CREATE TABLE public.user_profiles (id uuid PRIMARY KEY, subscription_status text, trial_expires_at timestamptz,
    stripe_subscription_id text, subscription_id text, commercial_trial_granted_at timestamptz);
  CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz)
    RETURNS text LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'pro'::text $fn$;
  INSERT INTO public.user_profiles (id, subscription_status) VALUES ('${U}', 'pro'), ('${OTHER}', 'pro');
  CREATE TABLE public.sessions (
    id uuid PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz,
    transcript text, ai_suggestions jsonb, ground_truth text, accuracy double precision,
    transcript_state text DEFAULT 'not_captured',
    total_words int, duration int, clarity_score double precision, wpm double precision,
    filler_words jsonb, custom_words text, pause_metrics jsonb, status text, status_reason text,
    title text, engine text, engine_version text, model_name text, device_type text, attribution_status text);

  ALTER TABLE public.sessions ADD CONSTRAINT sessions_transcript_state_check
    CHECK (transcript_state IN ('available','expired','not_captured'));
  -- Locked U1 invariant: an expired row never carries transcript text.
  ALTER TABLE public.sessions ADD CONSTRAINT sessions_expired_transcript_null_check
    CHECK (transcript_state <> 'expired' OR transcript IS NULL);

  -- Server-owned derivation, verbatim from 20260801000000 (incl. sticky expiry).
  CREATE OR REPLACE FUNCTION public.sessions_set_transcript_state() RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    IF TG_OP = 'UPDATE' AND OLD.transcript_state = 'expired' THEN
      NEW.transcript_state := 'expired'; NEW.transcript := NULL;
    ELSIF NEW.transcript IS NOT NULL AND NEW.transcript ~ '[^[:space:]]' THEN
      NEW.transcript_state := 'available';
    ELSE
      NEW.transcript_state := 'not_captured';
    END IF;
    RETURN NEW;
  END $fn$;
  CREATE TRIGGER trg_sessions_set_transcript_state
    BEFORE INSERT OR UPDATE OF transcript, transcript_state ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.sessions_set_transcript_state();

  -- Retention coordinator stub. Records that it ran, and can be told to fail, so the guarded call is testable.
  CREATE TABLE public.retention_calls (called_for uuid, at timestamptz DEFAULT now());
  CREATE TABLE public.retention_mode (mode text);
  INSERT INTO public.retention_mode VALUES ('ok');
  CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER AS $fn$
  DECLARE m text;
  BEGIN
    SELECT mode INTO m FROM public.retention_mode LIMIT 1;
    INSERT INTO public.retention_calls (called_for) VALUES (p_user_id);
    IF m = 'boom' THEN RAISE EXCEPTION 'retention exploded' USING ERRCODE = '55000'; END IF;
    -- 'hang' simulates a coordinator that blocks past a statement_timeout, producing query_canceled (57014)
    -- which WHEN OTHERS does NOT catch. Used to prove the session-metrics write survives (blocker 1).
    IF m = 'hang' THEN PERFORM pg_sleep(5); END IF;
    -- 'pending' simulates Option A deferral: convergence did NOT reduce to <=2 (no durable Progress evidence),
    -- returned as a RESULT, not an exception. Used to prove the new transcript is not retained (blocker 2).
    IF m = 'pending' THEN
      RETURN jsonb_build_object('status','pending','eligible_candidate_count',1,'pending_evidence_count',1,'expired_count',0);
    END IF;
    IF m = 'expire' THEN
      -- Simulate the newest-two sweep expiring the OLDEST transcript-bearing row for this user, using the SAME
      -- mechanism R1 uses: 'expired' can only be established with the derivation trigger suppressed
      -- (session_replication_role='replica'), which is precisely why no client can self-assert that state.
      SET LOCAL session_replication_role = 'replica';
      UPDATE public.sessions SET transcript_state = 'expired', transcript = NULL
      WHERE id = (SELECT id FROM public.sessions WHERE user_id = p_user_id AND transcript IS NOT NULL
                  ORDER BY created_at ASC LIMIT 1);
      SET LOCAL session_replication_role = 'origin';
    END IF;
    RETURN jsonb_build_object('status','converged','expired_count',0);
  END $fn$;

  -- Legacy transcript-accepting overload: this migration must NOT remove it.
  CREATE FUNCTION public.complete_session(p_session_id uuid, p_status text DEFAULT 'completed',
    p_final_transcript text DEFAULT NULL, p_final_duration integer DEFAULT NULL, p_reason text DEFAULT NULL)
    RETURNS jsonb LANGUAGE sql AS $fn$ SELECT jsonb_build_object('overload','legacy') $fn$;
`;

export async function db0(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  await db.exec(STAGE_A);
  await db.exec(ATOMIC);
  return db;
}

export async function actingAs(db: PGlite, uid: string) { await db.query(`UPDATE public.auth_ctx SET uid = $1`, [uid]); }

export async function newSession(db: PGlite, user = U): Promise<string> {
  const s = sid();
  await db.query(`INSERT INTO public.sessions (id, user_id, status, duration) VALUES ($1,$2,'active',0)`, [s, user]);
  return s;
}

export type Completion = { success: boolean; session_saved?: boolean; error?: string; final_status?: string; idempotent?: boolean; transcript_state?: string; transcript_outcome?: 'retained'|'not_provided'|'not_captured'|'retention_failed'|'expired'; transcript_retained?: boolean; retention?: { status: string; sqlstate?: string; reason?: string } };

export async function complete(db: PGlite, s: string, over: Record<string, unknown> = {}) {
  const a = { transcript: 'synthetic transcript text', words: 100, duration: 60, fillers: '{}', ...over };
  const r = await db.query<{ r: Completion }>(
    `SELECT public.complete_session_v2(
        p_session_id => $1::uuid, p_status => 'completed', p_final_duration => $2::int,
        p_next_action => $3::jsonb, p_total_words => $4::int, p_filler_counts => $5::jsonb,
        p_final_transcript => $6::text) AS r`,
    [s, a.duration, a.next_action === null ? null : REC, a.words, a.fillers, a.transcript]);
  return r.rows[0].r;
}

export const transcriptBearingCount = async (db: PGlite, user: string) =>
  (await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.sessions
     WHERE user_id = $1 AND transcript IS NOT NULL AND transcript ~ '[^[:space:]]'`, [user])).rows[0].n;

export const row = async (db: PGlite, s: string) => (await db.query<{ transcript: string | null; transcript_state: string; status: string; total_words: number | null; filler_counts: unknown; next_action_signal: unknown; duration: number }>(
  `SELECT transcript, transcript_state, status, total_words, filler_counts, next_action_signal, duration FROM public.sessions WHERE id = $1`, [s])).rows[0];
