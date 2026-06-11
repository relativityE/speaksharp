-- Launch safety: Basic is not an active public tier.
--
-- Older migrations introduced Basic as an unpaid/future tier. Current launch
-- policy is Free + Pro, so any lingering Basic configuration must behave like
-- Free until paid Basic is deliberately reintroduced.

UPDATE public.user_profiles
SET subscription_status = 'free',
    updated_at = now()
WHERE lower(COALESCE(subscription_status, '')) = 'basic';

INSERT INTO public.tier_configs (
  tier_name,
  daily_limit_seconds,
  monthly_limit_seconds,
  max_concurrent_sessions,
  allowed_engines
)
SELECT
  'basic',
  daily_limit_seconds,
  monthly_limit_seconds,
  max_concurrent_sessions,
  allowed_engines
FROM public.tier_configs
WHERE tier_name = 'free'
ON CONFLICT (tier_name) DO UPDATE
SET
  daily_limit_seconds = EXCLUDED.daily_limit_seconds,
  monthly_limit_seconds = EXCLUDED.monthly_limit_seconds,
  max_concurrent_sessions = EXCLUDED.max_concurrent_sessions,
  allowed_engines = EXCLUDED.allowed_engines;

CREATE OR REPLACE FUNCTION public.effective_subscription_tier(
  p_subscription_status TEXT,
  p_trial_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_stripe_subscription_id TEXT DEFAULT NULL,
  p_subscription_id TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_trial_expires_at IS NOT NULL
      AND p_trial_expires_at > now()
    THEN 'pro'
    WHEN lower(COALESCE(p_subscription_status, 'free')) = 'pro'
    THEN 'pro'
    ELSE 'free'
  END;
$$;

COMMENT ON FUNCTION public.effective_subscription_tier(TEXT, TIMESTAMPTZ, TEXT, TEXT) IS
  'Returns launch entitlement tier. Active trial and Pro resolve to pro; all non-Pro statuses, including legacy Basic, resolve to free.';
