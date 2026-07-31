-- Throwaway bootstrap for executing the #1045 Progress migrations in a REAL PostgreSQL.
-- NOT a migration; never applied anywhere. Gives a bare engine the objects Supabase preinstalls (roles,
-- auth schema, auth.uid, a production-shaped sessions table) so the two migrations apply verbatim and the
-- RPCs actually EXECUTE. Content-free: synthetic UUIDs only.

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

-- public.sessions — the columns record_progress_evaluation() reads, matching production shape.
CREATE TABLE IF NOT EXISTS public.sessions (
    id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    duration           integer,
    total_words        integer,
    filler_words       jsonb DEFAULT '{}',
    transcript         text,
    wpm                double precision,
    engine             text,
    engine_version     text,
    model_name         text,
    attribution_status text,
    status             text DEFAULT 'active',
    created_at         timestamptz DEFAULT now()
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own sessions" ON public.sessions;
CREATE POLICY "Users can manage own sessions" ON public.sessions
    FOR ALL USING ((SELECT auth.uid()) = user_id);

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sessions TO authenticated;
