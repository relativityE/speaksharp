-- Throwaway bootstrap for executing the #1161 attribution-authority migration in a REAL PostgreSQL (PGlite or a
-- local cluster). NOT a migration; never applied anywhere. Supplies only what a bare engine lacks and Supabase
-- preinstalls: roles, the auth schema + auth.uid(), and a production-shaped public.sessions carrying EVERY
-- column the #1161 migration references — the locked attribution-identity set (engine, engine_version,
-- model_name, device_type, attribution_status) plus the full safe-column whitelist the table-level UPDATE
-- revoke re-grants — so the migration applies verbatim and the ACL change is exercisable.
-- Content-free: synthetic UUIDs only.

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

-- public.sessions — production-shaped. The attribution-identity columns are what #1161 locks; the operational
-- columns are the safe-column whitelist re-granted after the table-level UPDATE revoke. attribution_status
-- keeps the production CHECK vocabulary. A pre-existing table-level UPDATE grant to `authenticated` models the
-- production posture that the migration must REVOKE (proving the revoke is load-bearing, not a no-op).
CREATE TABLE IF NOT EXISTS public.sessions (
    id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    -- locked attribution identity (server-owned; NOT in the re-grant whitelist)
    engine             text,
    engine_version     text,
    model_name         text,
    device_type        text,
    attribution_status text NOT NULL DEFAULT 'pending'
        CHECK (attribution_status IN ('pending', 'verified', 'unverified', 'legacy_unknown')),
    -- safe operational columns (the re-grant whitelist)
    title              text,
    duration           integer NOT NULL DEFAULT 0,
    total_words        integer NOT NULL DEFAULT 0,
    filler_words       jsonb   NOT NULL DEFAULT '{}'::jsonb,
    accuracy           double precision,
    ground_truth       text,
    transcript         text,
    clarity_score      double precision,
    wpm                double precision,
    status             text,
    status_reason      text,
    pause_metrics      jsonb,
    transcript_state   text,
    ai_suggestions     jsonb
);
GRANT SELECT, INSERT, DELETE ON public.sessions TO authenticated;
GRANT UPDATE ON public.sessions TO authenticated;  -- production posture the migration must REVOKE
GRANT ALL ON public.sessions TO service_role;
