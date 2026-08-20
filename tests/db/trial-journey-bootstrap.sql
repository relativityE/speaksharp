-- Throwaway bootstrap for EXECUTING the #1282 trial foundation + enforcement migrations in a real
-- PostgreSQL (PGlite). Supplies only what a bare engine lacks: roles, auth.uid(), and the production-shaped
-- user_profiles / trial_entitlements / tier_configs the migrations reference. The migrations under test are
-- applied VERBATIM by the test. Content-free: synthetic ids only.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;
ALTER ROLE service_role BYPASSRLS;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE IF NOT EXISTS public.user_profiles (
    id uuid PRIMARY KEY,
    subscription_status text DEFAULT 'free',
    stripe_subscription_id text,
    subscription_id text,
    daily_usage_seconds int DEFAULT 0,
    native_usage_seconds int DEFAULT 0,
    cloud_usage_seconds int DEFAULT 0,
    last_daily_reset timestamptz,
    usage_reset_date timestamptz,
    usage_seconds int DEFAULT 0,
    private_sample_limit_seconds int DEFAULT 300,
    private_sample_seconds_used int DEFAULT 0,
    private_sample_session_id uuid,
    private_sample_started_at timestamptz,
    private_sample_completed_at timestamptz,
    trial_started_at timestamptz,
    trial_expires_at timestamptz,
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trial_entitlements (
    email text PRIMARY KEY, user_id uuid,
    trial_started_at timestamptz DEFAULT now(), trial_expires_at timestamptz, updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tier_configs (
    tier_name text PRIMARY KEY, daily_limit_seconds int, monthly_limit_seconds int,
    allowed_engines text[], max_concurrent_sessions int DEFAULT 1
);
-- Pre-#1282 seed: 'pro' still carries the old Browser/Cloud/Native allowance. The #1282 enforcement
-- migration restricts it to Private-only; the test proves that transition.
INSERT INTO public.tier_configs (tier_name, daily_limit_seconds, monthly_limit_seconds, allowed_engines)
VALUES ('free', 3600, 90000, ARRAY['native']::text[]),
       ('pro',  7200, 180000, ARRAY['native', 'private', 'cloud']::text[])
ON CONFLICT (tier_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    title text,
    duration int DEFAULT 0,
    total_words int DEFAULT 0,
    filler_words jsonb DEFAULT '{}'::jsonb,
    accuracy float8,
    ground_truth text,
    transcript text,
    clarity_score float8,
    wpm float8,
    idempotency_key uuid,
    engine_version text,
    model_name text,
    device_type text,
    status text DEFAULT 'active',
    status_reason text,
    engine text DEFAULT 'private',
    expires_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.usage_checkpoints (
    session_id uuid,
    user_id uuid,
    incremental_seconds int,
    engine_type text
);

-- Production-shaped direct-table privileges and pre-#1282 owner-wide RLS. The enforcement migration must
-- replace the broad session policy with entitlement-aware INSERT/UPDATE while retaining owner reads/deletes.
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT ALL ON public.user_profiles, public.sessions TO service_role;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
CREATE POLICY "Users can view own profile" ON public.user_profiles
FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = id);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own sessions" ON public.sessions;
CREATE POLICY "Users can manage own sessions" ON public.sessions
FOR ALL TO authenticated
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);

-- Test-only SECURITY INVOKER wrappers. They execute real direct table DML under SET ROLE authenticated /
-- service_role and catch only RLS/privilege rejection so the matrix can assert negative paths without
-- aborting the psql session. These are disposable harness helpers, never production migrations.
CREATE OR REPLACE FUNCTION public.matrix_try_session_insert(p_session_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.sessions(id, user_id, duration, transcript, status)
  VALUES (p_session_id, p_user_id, 10, 'matrix direct insert', 'active');
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.matrix_try_session_update(p_session_id uuid, p_transcript text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows int;
BEGIN
  UPDATE public.sessions
     SET transcript = p_transcript,
         status = 'completed',
         total_words = 42,
         updated_at = now()
   WHERE id = p_session_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.matrix_can_read_session(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.sessions WHERE id = p_session_id)
$$;

GRANT EXECUTE ON FUNCTION public.matrix_try_session_insert(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matrix_try_session_update(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.matrix_can_read_session(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.converge_transcript_retention(uuid)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('status', 'ok') $$;
