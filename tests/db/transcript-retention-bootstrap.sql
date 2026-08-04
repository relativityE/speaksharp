-- Throwaway bootstrap for EXECUTING the #1117 R1 retention contract in a REAL PostgreSQL (PGlite).
--
-- NOT a migration; NEVER applied to any hosted environment. It supplies only the objects a bare engine
-- lacks but Supabase preinstalls, so the real migration files can then be applied VERBATIM from disk and
-- the functions actually EXECUTED. Test order is:
--   1) this bootstrap                     (auth schema + auth.uid() + roles + final public.sessions shape)
--   2) 20260801000000_sessions_transcript_state.sql   (#1131 — adds transcript_state + trigger + CHECKs)
--   3) 20260803000000_transcript_retention_newest_two.sql  (#1117 R1 — predicate + mutation, under test)
--
-- Column provenance mirrors tests/db/analytics-summary-bootstrap.sql (the canonical sessions shape). Keep in
-- sync when the table changes. Content-free: synthetic UUIDs and synthetic transcripts only.

-- Roles the R1 migration REVOKE/GRANTs against. A bare engine has none of these.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role;  END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon;          END IF;
END $$;

-- Supabase's auth schema + auth.uid() (backed by a GUC so a test can impersonate a user). The sessions RLS
-- policy uses it.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Final shape of public.sessions BEFORE #1131 (transcript_state is added by the #1131 migration on top).
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

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own sessions" ON public.sessions;
CREATE POLICY "Users can manage own sessions" ON public.sessions
    FOR ALL USING ((SELECT auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sessions TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
