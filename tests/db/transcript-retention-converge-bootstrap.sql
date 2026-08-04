-- Throwaway bootstrap for EXECUTING the #1117 R2 retention COORDINATOR in a real PostgreSQL (PGlite).
-- NOT a migration; never applied to any hosted environment. Supplies only what a bare engine lacks so the
-- real migration files apply verbatim on top:
--   1) this bootstrap  (auth + roles + sessions + minimal user_profiles + minimal session_progress_evaluations)
--   2) 20260801000000_sessions_transcript_state.sql   (#1131 transcript_state + trigger + CHECKs)
--   3) 20260803000000_transcript_retention_newest_two.sql  (merged R1 predicate/version/mutation)
--   4) 20260804000000_transcript_retention_converge_on_save.sql  (#1117 R2 coordinator, under test)
-- Content-free: synthetic UUIDs and synthetic transcripts only. The full record_progress_evaluation RPC is
-- NOT reproduced here — the coordinator only reads session_progress_evaluations existence/columns, so a
-- minimal table (seeded directly) is a faithful, focused stand-in for its output.

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role;  END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon;          END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Minimal user_profiles — the coordinator locks this row (FOR UPDATE) for per-user serialization.
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

-- public.sessions (pre-#1131 shape; transcript_state added by the #1131 migration).
CREATE TABLE IF NOT EXISTS public.sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title text,
    duration integer,
    total_words integer,
    filler_words jsonb DEFAULT '{}',
    custom_words jsonb DEFAULT '{}',
    created_at timestamp with time zone DEFAULT now(),
    accuracy float4,
    ground_truth text,
    transcript text,
    engine text,
    clarity_score float8,
    wpm float8,
    ai_suggestions jsonb,
    idempotency_key uuid UNIQUE,
    expires_at timestamptz,
    engine_version text,
    model_name text,
    device_type text,
    status text DEFAULT 'active',
    status_reason text,
    updated_at timestamptz DEFAULT now(),
    pause_metrics jsonb DEFAULT '{}'::jsonb,
    attribution_status text NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions (user_id);

-- Minimal session_progress_evaluations — only the columns the coordinator's evidence gate reads, plus the
-- real UNIQUE(session_id, formula_version) key and the ON DELETE CASCADE FK (for deletion-cascade tests).
CREATE TABLE IF NOT EXISTS public.session_progress_evaluations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    formula_version text NOT NULL,
    attribution_status text,
    eligible boolean NOT NULL,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT spe_session_formula_key UNIQUE (session_id, formula_version)
);

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sessions TO authenticated;
