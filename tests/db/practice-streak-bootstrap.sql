-- Throwaway bootstrap for executing the practice-streak functions in a REAL PostgreSQL.
-- NOT a migration; never applied to any hosted environment. It gives a bare engine the objects
-- Supabase preinstalls (roles, auth schema, auth.uid, user_profiles, sessions + RLS) so the streak
-- migration can be applied verbatim and the functions actually EXECUTED. Content-free: synthetic UUIDs.

-- Roles the migration GRANTs to.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

-- Identity backed by a GUC so a test can impersonate a user (mirrors Supabase auth.uid()).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Supabase grants app roles access to the auth schema + auth.uid().
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;

-- public.user_profiles (initial_schema shape; the migration adds the `timezone` column).
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id),
    subscription_status text DEFAULT 'basic',
    created_at timestamptz DEFAULT now()
);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
CREATE POLICY "Users can view own profile" ON public.user_profiles
    FOR ALL USING (auth.uid() = id);

-- public.sessions (only the columns the streak reads; RLS confines to the owner).
CREATE TABLE IF NOT EXISTS public.sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    total_words integer,
    created_at timestamptz DEFAULT now()
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own sessions" ON public.sessions;
CREATE POLICY "Users can manage own sessions" ON public.sessions
    FOR ALL USING ((SELECT auth.uid()) = user_id);

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_profiles TO authenticated;
