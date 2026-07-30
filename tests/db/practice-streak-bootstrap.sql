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

-- public.user_profiles — reproduces the PRODUCTION shape after 20260522090000_harden_runtime_billing_
-- invariants: RLS is SELECT-ONLY for authenticated (the original FOR ALL policy was removed precisely so
-- users cannot directly write their profile / billing / entitlement fields). `subscription_status` is
-- included as a representative entitlement field a caller must NOT be able to modify directly.
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id),
    subscription_status text DEFAULT 'basic',
    created_at timestamptz DEFAULT now()
);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can select own profile" ON public.user_profiles;
-- SELECT-only (matches production). No INSERT/UPDATE/DELETE policy exists, so authenticated cannot
-- write user_profiles directly — the timezone is initialized ONLY via the SECURITY DEFINER setter.
CREATE POLICY "Users can select own profile" ON public.user_profiles
    FOR SELECT USING ((SELECT auth.uid()) = id);

-- public.sessions — includes `status` (20260309000000: active|completed|expired|failed, default active),
-- which the streak now filters on. RLS FOR ALL confines to the owner, as in production.
CREATE TABLE IF NOT EXISTS public.sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    total_words integer,
    status text DEFAULT 'active',
    created_at timestamptz DEFAULT now()
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own sessions" ON public.sessions;
CREATE POLICY "Users can manage own sessions" ON public.sessions
    FOR ALL USING ((SELECT auth.uid()) = user_id);

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sessions TO authenticated;
-- Production-faithful: 20260522090000 removed the UPDATE *policy* but did NOT revoke the underlying
-- table privilege. So authenticated RETAINS table-level SELECT+UPDATE here; the write is blocked purely
-- by RLS (no UPDATE/ALL policy exists → the UPDATE matches zero rows). Granting only SELECT would prove
-- the block at the wrong (privilege) layer and mask whether RLS actually denies the row.
GRANT SELECT, UPDATE ON TABLE public.user_profiles TO authenticated;
