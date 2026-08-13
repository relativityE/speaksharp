-- #1282 / #1266 — 30-day full-product trial -> $10/month lifecycle (server-authoritative).
--
-- MODEL SHIFT. The prior release model (20260610 private_sample_entitlement) removed the time-based
-- trial and gave free users a 300-second "private sample". #1266 fixes the commercial contract as ONE
-- product: the COMPLETE product is free for a new account's first 30 days, then $10/month to continue.
-- This migration restores a 30-day, server-authoritative trial window and makes a LIVE (unexpired)
-- trial grant full product access, WITHOUT weakening the paid-Pro invariant.
--
-- What this migration does (slice 1 of #1282 — entitlement foundation):
--   1. Adds a canonical resolver whose LIVE-trial branch requires both an unexpired trial window and
--      the immutable commercial grant marker. Paid Pro still requires subscription_status='pro' AND a
--      real stripe_subscription_id. Legacy windows alone cannot grant access.
--   2. Redefines public.ensure_trial_profile_for_new_user() so a NEW account is stamped with a 30-day
--      full-product window (trial_started_at = now(), trial_expires_at = now() + 30 days).
--   3. Leaves existing accounts unmarked. Their one-time activation is a later, separately-authorized
--      migration that follows the entitlement enforcement migration in version order.
--   4. Restores a 30-day DEFAULT on the trial_expires_at columns for defence-in-depth.
--
-- Enforcement of the EXPIRED state (fail-closed: no new recording/persistence/analysis; read/export/
-- account-management/upgrade stay available) is the next source migration.
--
-- Applying this migration activates NO billing and charges nothing. It only re-shapes entitlement.

-- The marker belongs to the foundation so account provisioning can stamp it atomically. Existing rows
-- remain NULL until the separately-authorized commercial activation migration runs.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS commercial_trial_granted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_profiles.commercial_trial_granted_at IS
  '#1282 immutable authority for the single commercial trial grant. New accounts receive it at signup; '
  'legacy unpaid accounts receive it only through the separately-authorized activation migration.';

-- Once set, the authority cannot be cleared or moved. NULL -> timestamp is the only allowed transition.
CREATE OR REPLACE FUNCTION public.preserve_commercial_trial_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.commercial_trial_granted_at IS NOT NULL
     AND NEW.commercial_trial_granted_at IS DISTINCT FROM OLD.commercial_trial_granted_at THEN
    RAISE EXCEPTION 'commercial_trial_granted_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_commercial_trial_grant ON public.user_profiles;
CREATE TRIGGER preserve_commercial_trial_grant
BEFORE UPDATE OF commercial_trial_granted_at ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION public.preserve_commercial_trial_grant();

REVOKE EXECUTE ON FUNCTION public.preserve_commercial_trial_grant() FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Entitlement resolver. The legacy four-argument signature remains fail-closed for trial access;
--    the canonical five-argument signature requires the immutable commercial grant marker.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
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
    -- Paid Pro: explicit 'pro' status backed by a REAL Stripe subscription. Unchanged invariant.
    WHEN lower(COALESCE(p_subscription_status, 'free')) = 'pro'
      AND NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), '') IS NOT NULL
    THEN 'pro'
    ELSE 'free'
  END;
$$;

COMMENT ON FUNCTION public.effective_subscription_tier(TEXT, TIMESTAMPTZ, TEXT, TEXT) IS
  '#1282 compatibility resolver. Paid access requires status=pro and a real Stripe subscription. Trial '
  'access fails closed because this legacy signature cannot carry the immutable commercial grant marker.';

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

COMMENT ON FUNCTION public.effective_subscription_tier(TEXT, TIMESTAMPTZ, TEXT, TEXT, TIMESTAMPTZ) IS
  '#1282 canonical practice entitlement. Full Private product when paid, or when both the immutable '
  'commercial grant marker and an unexpired server-side window exist. The legacy subscription_id is ignored.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. New-user provisioning — stamp a 30-day full-product window.
--    Re-applies the 20260811143000 hardening (search_path, EXECUTE revoke) since we replace the fn.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_trial_profile_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    subscription_status,
    private_sample_limit_seconds,
    private_sample_seconds_used,
    trial_started_at,
    trial_expires_at,
    commercial_trial_granted_at
  )
  VALUES (
    NEW.id,
    'free',
    300,
    0,
    now(),
    now() + interval '30 days',
    now()
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
    -- Preserve an existing window if the profile already had one (idempotent re-entry); only stamp
    -- the fresh 30-day window when absent. Never shortens or backdates a live window.
    trial_started_at = COALESCE(public.user_profiles.trial_started_at, EXCLUDED.trial_started_at),
    trial_expires_at = COALESCE(public.user_profiles.trial_expires_at, EXCLUDED.trial_expires_at),
    commercial_trial_granted_at = public.user_profiles.commercial_trial_granted_at,
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_trial_profile_for_new_user() FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. The one-time ACTIVATION stamp for existing unpaid beta accounts is intentionally NOT here.
--    #1282 blocker 3: stamping every existing unpaid account starts their 30-day clock at APPLY time, so
--    it must run at the recorded COMMERCIAL-ACTIVATION time — not during an early compatibility/security
--    apply of this foundation migration. It is a SEPARATE, launch-authorized migration
--    (20260812042000_trial_activation_stamp_1282.sql). Applying THIS migration early is safe: existing
--    unpaid accounts keep trial_expires_at NULL and resolve to 'free' (fail closed) until the stamp runs;
--    new accounts start their own 30-day clock at signup via ensure_trial_profile_for_new_user above.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Defence-in-depth: restore a 30-day DEFAULT on the trial window columns (dropped by 20260610).
--    Provisioning above is explicit; this default only backstops any direct insert path.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ALTER COLUMN trial_expires_at SET DEFAULT (now() + interval '30 days');

ALTER TABLE public.trial_entitlements
  ALTER COLUMN trial_expires_at SET DEFAULT (now() + interval '30 days');
