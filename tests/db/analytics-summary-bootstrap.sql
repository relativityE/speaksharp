-- Throwaway bootstrap for executing get_analytics_summary in a REAL PostgreSQL.
--
-- This file is NOT a migration and is NEVER applied to any hosted environment. It exists only to give
-- an ephemeral in-process PostgreSQL (PGlite) the objects a bare engine lacks but Supabase preinstalls,
-- so that the real migration file can then be applied verbatim and the function actually EXECUTED.
--
-- Why not replay backend/supabase/migrations/*.sql wholesale: 20250825065500_fix_rls_performance_issue.sql
-- issues `DROP POLICY "Users can view their own sessions" ON public.sessions;` WITHOUT `IF EXISTS` for four
-- policies that no migration in this repo ever creates (they existed only in the remote database), and then
-- re-creates a policy that already exists. A from-scratch replay aborts there. So the final `sessions` shape
-- is reproduced here, with each column annotated with the migration it comes from. Keep this in sync when
-- the table changes; the column set is asserted against the real migrations by the accompanying test.
--
-- Column provenance:
--   20250811062708_initial_schema.sql          id, user_id, title, duration, total_words,
--                                              filler_words, custom_words, created_at, RLS + policy
--   20250819072116_add_accuracy_to_sessions    accuracy (float4 — deliberately NOT float8)
--   20250925071946_add_ground_truth_to_sessions ground_truth
--   20251219000000_sync_contract               transcript, engine, clarity_score (float8), wpm (float8)
--   20260212000000_database_hardening          user_id FK -> auth.users ON DELETE CASCADE
--   20260221213044_add_ai_suggestions           ai_suggestions
--   20260309000000_phase2_integration           idempotency_key, expires_at, engine_version, model_name,
--                                              device_type, status
--   20260324000000_finalize_session_failed      status_reason, updated_at
--   20260325000000_fail_closed_usage_guards     sessions_duration_non_negative CHECK (NOT VALID)
--   20260326000000_session_analysis_snapshot    pause_metrics
--   20260530102000_grant_authenticated_...      GRANT on public.sessions TO authenticated
--   20260724220000_sessions_attribution_status  attribution_status + CHECK + partial index

-- Roles the migration GRANTs to. A bare engine has neither.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;

-- Supabase's auth schema. `get_analytics_summary` calls auth.uid() for its authorization check, and the
-- RLS policy on sessions uses it too. Backed by a GUC so a test can impersonate a user.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Final shape of public.sessions.
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

ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_duration_non_negative;
ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_duration_non_negative
    CHECK (duration IS NULL OR duration >= 0) NOT VALID;

ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_attribution_status_check;
ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_attribution_status_check
    CHECK (attribution_status IN ('pending', 'verified', 'unverified', 'legacy_unknown'));

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_user_id_created_at_idx ON public.sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_attribution_verified
    ON public.sessions (user_id) WHERE attribution_status = 'verified';

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own sessions" ON public.sessions;
CREATE POLICY "Users can manage own sessions" ON public.sessions
    FOR ALL USING ((SELECT auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sessions TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
