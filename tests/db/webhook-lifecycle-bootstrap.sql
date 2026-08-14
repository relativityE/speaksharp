-- Throwaway bootstrap for EXECUTING the #1282 webhook-lifecycle migration in a REAL PostgreSQL (PGlite).
-- NOT a migration; never applied anywhere. Supplies only what a bare engine lacks and Supabase
-- preinstalls: roles, and the minimal public.user_profiles / public.processed_webhook_events shapes the
-- migration REFERENCES, plus a paid-entitlement compatibility stub for the #1282 foundation migration
-- 20260812040000 (these tests exercise paid webhook transitions). The artefact under test — the webhook
-- migration 20260812002000 (process_stripe_webhook_event) — is applied VERBATIM from disk by the test and
-- is never rewritten here. Content-free: synthetic ids only.

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Minimal production-shaped user_profiles (only the columns the webhook RPC + resolver touch).
-- NOTE: last_stripe_event_at is intentionally ABSENT — the migration's ADD COLUMN IF NOT EXISTS adds it,
-- so applying the migration also proves that ALTER.
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id                            uuid PRIMARY KEY,
    subscription_status           text DEFAULT 'free',
    stripe_subscription_id        text,
    stripe_customer_id            text,
    subscription_id               text,
    private_sample_limit_seconds  int DEFAULT 300,
    private_sample_seconds_used   int DEFAULT 0,
    private_sample_completed_at   timestamptz,
    trial_expires_at              timestamptz,
    commercial_trial_granted_at   timestamptz,
    daily_usage_seconds           int DEFAULT 0,
    native_usage_seconds          int DEFAULT 0,
    cloud_usage_seconds           int DEFAULT 0,
    usage_seconds                 int DEFAULT 0,
    last_daily_reset              timestamptz,
    usage_reset_date              timestamptz,
    updated_at                    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    title text,
    duration int DEFAULT 0,
    total_words int DEFAULT 0,
    filler_words jsonb DEFAULT '{}'::jsonb,
    accuracy float8,
    ground_truth text,
    transcript text,
    engine text,
    clarity_score float8,
    wpm float8,
    idempotency_key uuid,
    engine_version text,
    model_name text,
    device_type text,
    status text,
    status_reason text,
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

CREATE TABLE IF NOT EXISTS public.tier_configs (
    tier_name text PRIMARY KEY,
    allowed_engines text[],
    max_concurrent_sessions int
);
INSERT INTO public.tier_configs (tier_name, allowed_engines, max_concurrent_sessions)
VALUES ('free', ARRAY[]::text[], 1), ('pro', ARRAY['private']::text[], 1)
ON CONFLICT (tier_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('status', 'ok') $$;

CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
    event_id     text PRIMARY KEY,
    event_type   text,
    processed_at timestamptz DEFAULT now()
);

-- Paid-path compatibility stub of the #1282 resolver. Trial-marker behavior is exercised by the dedicated
-- trial journey suite; this bootstrap asserts paid webhook lifecycle transitions only.
CREATE OR REPLACE FUNCTION public.effective_subscription_tier(
  p_subscription_status TEXT,
  p_trial_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_stripe_subscription_id TEXT DEFAULT NULL,
  p_subscription_id TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_subscription_status, 'free')) = 'pro'
      AND NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), '') IS NOT NULL
    THEN 'pro'
    ELSE 'free'
  END;
$$;

CREATE OR REPLACE FUNCTION public.effective_subscription_tier(
  p_subscription_status TEXT,
  p_trial_expires_at TIMESTAMPTZ,
  p_stripe_subscription_id TEXT,
  p_subscription_id TEXT,
  p_commercial_trial_granted_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_subscription_status, 'free')) = 'pro'
      AND NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), '') IS NOT NULL
    THEN 'pro'
    WHEN p_commercial_trial_granted_at IS NOT NULL
      AND p_trial_expires_at IS NOT NULL
      AND p_trial_expires_at > now()
    THEN 'pro'
    ELSE 'free'
  END;
$$;

-- Production-shaped old-Edge contract. #1287 must leave this six-argument RPC untouched so the currently
-- deployed Edge can continue to run after the database prerequisite is applied and before #1282 deploys.
CREATE OR REPLACE FUNCTION public.process_stripe_webhook_event(
    p_event_id text,
    p_event_type text,
    p_action text,
    p_user_id uuid DEFAULT NULL,
    p_subscription_id text DEFAULT NULL,
    p_stripe_customer_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at)
    VALUES (p_event_id, p_event_type, now());

    IF p_action = 'upgrade_to_pro' THEN
        UPDATE public.user_profiles
           SET subscription_status = 'pro',
               stripe_subscription_id = p_subscription_id,
               stripe_customer_id = COALESCE(NULLIF(BTRIM(COALESCE(p_stripe_customer_id, '')), ''), stripe_customer_id),
               updated_at = now()
         WHERE id = p_user_id;
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text, text)
  TO service_role;
