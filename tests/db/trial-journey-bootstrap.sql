-- Throwaway bootstrap for EXECUTING the #1282 trial foundation + enforcement migrations in a real
-- PostgreSQL (PGlite). Supplies only what a bare engine lacks: roles, auth.uid(), and the production-shaped
-- user_profiles / trial_entitlements / tier_configs the migrations reference. The migrations under test are
-- applied VERBATIM by the test. Content-free: synthetic ids only.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;

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
