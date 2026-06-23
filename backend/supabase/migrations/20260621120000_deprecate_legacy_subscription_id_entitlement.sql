-- Deprecate the legacy `subscription_id` column as a paid-entitlement signal.
--
-- Canonical-ID policy (release-owner, 2026-06): `stripe_subscription_id` is the ONLY production
-- paid subscription identifier. The legacy `subscription_id` column is NO LONGER a paid signal.
-- Previously both the entitlement resolver and the new-user guard treated
-- `stripe_subscription_id OR subscription_id` as paid; this re-creates both so a profile is Pro
-- only when `subscription_status='pro' AND stripe_subscription_id` is present.
--
-- The `subscription_id` COLUMN is intentionally NOT dropped here (read-removal first; a column
-- drop/backfill can follow once nothing depends on it). Frontend reads were removed in the same
-- PR (hasPaidProEntitlement, TranscriptionProvider) and test fixtures stopped writing it.
--
-- effective_subscription_tier keeps its 4-arg signature — many existing migrations/RPCs call it
-- with profile.subscription_id as the 4th arg — so the parameter is accepted but IGNORED.

CREATE OR REPLACE FUNCTION public.effective_subscription_tier(
  p_subscription_status TEXT,
  p_trial_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_stripe_subscription_id TEXT DEFAULT NULL,
  p_subscription_id TEXT DEFAULT NULL  -- DEPRECATED: no longer read; kept for caller compatibility
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_subscription_status, 'free')) = 'pro'
      AND NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), '') IS NOT NULL
    THEN 'pro'
    ELSE 'free'
  END;
$$;

COMMENT ON FUNCTION public.effective_subscription_tier(TEXT, TIMESTAMPTZ, TEXT, TEXT) IS
  'Returns release entitlement tier. Pro requires subscription_status=pro AND a real stripe_subscription_id. The legacy subscription_id (4th arg) is deprecated and ignored; legacy trial timestamps do not grant Pro.';

CREATE OR REPLACE FUNCTION public.ensure_trial_profile_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    subscription_status,
    private_sample_limit_seconds,
    private_sample_seconds_used,
    trial_started_at,
    trial_expires_at
  )
  VALUES (
    NEW.id,
    'free',
    300,
    0,
    NULL,
    NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    subscription_status = CASE
      WHEN lower(COALESCE(public.user_profiles.subscription_status, 'free')) = 'pro'
        AND NULLIF(trim(COALESCE(public.user_profiles.stripe_subscription_id, '')), '') IS NOT NULL
      THEN public.user_profiles.subscription_status
      ELSE 'free'
    END,
    private_sample_limit_seconds = COALESCE(public.user_profiles.private_sample_limit_seconds, EXCLUDED.private_sample_limit_seconds),
    private_sample_seconds_used = COALESCE(public.user_profiles.private_sample_seconds_used, 0),
    updated_at = now();

  RETURN NEW;
END;
$$;
