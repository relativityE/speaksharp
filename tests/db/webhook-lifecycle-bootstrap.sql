-- Throwaway bootstrap for EXECUTING the #1282 webhook-lifecycle migration in a REAL PostgreSQL (PGlite).
-- NOT a migration; never applied anywhere. Supplies only what a bare engine lacks and Supabase
-- preinstalls: roles, and the minimal public.user_profiles / public.processed_webhook_events shapes the
-- migration REFERENCES, plus a faithful public.effective_subscription_tier stub mirroring #1282 migration
-- 20260812000000 (so entitlement transitions can be asserted). The artefact under test — the webhook
-- migration 20260812002000 (process_stripe_webhook_event) — is applied VERBATIM from disk by the test and
-- is never rewritten here. Content-free: synthetic ids only.

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
END $$;

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
    updated_at                    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
    event_id     text PRIMARY KEY,
    event_type   text,
    processed_at timestamptz DEFAULT now()
);

-- Faithful stub of the #1282 resolver (migration 20260812000000): full product (pro) when paid
-- (status=pro AND a real stripe_subscription_id) OR inside a live trial (trial_expires_at > now());
-- otherwise free. Lets the test assert entitlement at each lifecycle step.
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
    WHEN p_trial_expires_at IS NOT NULL AND p_trial_expires_at > now()
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
