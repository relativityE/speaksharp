-- Throwaway bootstrap for executing the #1046 G1 migration in a REAL PostgreSQL (PGlite).
-- NOT a migration; never applied anywhere. Supplies only what a bare engine lacks and Supabase preinstalls:
-- roles, the auth schema + auth.uid(), a production-shaped public.sessions, and the minimal
-- public.progress_recommendations shape the G1 migration REFERENCES (FK + the #1045 clarity read) — stubbed
-- exactly as the existing bootstraps stub public.sessions rather than re-applying an unrelated migration.
-- Content-free: synthetic UUIDs only; no brief/cue/transcript content.

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

-- public.sessions — G1 only needs (id, user_id) for the optional source-recording link + ownership check.
CREATE TABLE IF NOT EXISTS public.sessions (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now()
);

-- public.progress_recommendations — #1045 clarity source. Only the columns the G1 selector reads + the PK the
-- G1 FK targets. Stubbed (not the full #1045 migration) to keep the FK/read resolvable and content-free.
CREATE TABLE IF NOT EXISTS public.progress_recommendations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_session_id   uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    formula_version     text NOT NULL DEFAULT 'clarity_v1',
    target_metric       text NOT NULL,
    target_direction    text NOT NULL DEFAULT 'decrease',
    target_value        double precision NOT NULL,
    target_units        text NOT NULL DEFAULT 'per_min',
    source_metric_value double precision NOT NULL,
    shown_text          text NOT NULL DEFAULT '',
    shown_at            timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now()
);
