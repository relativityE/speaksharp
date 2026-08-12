-- #1282 / #1266 — 30-day full-product trial -> $10/month lifecycle (server-authoritative).
--
-- MODEL SHIFT. The prior release model (20260610 private_sample_entitlement) removed the time-based
-- trial and gave free users a 300-second "private sample". #1266 fixes the commercial contract as ONE
-- product: the COMPLETE product is free for a new account's first 30 days, then $10/month to continue.
-- This migration restores a 30-day, server-authoritative trial window and makes a LIVE (unexpired)
-- trial grant full product access, WITHOUT weakening the paid-Pro invariant.
--
-- What this migration does (slice 1 of #1282 — entitlement foundation):
--   1. Re-adds a LIVE-trial branch to public.effective_subscription_tier: an unexpired trial window
--      resolves to 'pro' (full product). Paid Pro still requires subscription_status='pro' AND a real
--      stripe_subscription_id — that invariant is unchanged. Legacy pre-#1282 trial timestamps are all
--      long expired (old windows were 60min/24h), so this cannot retroactively grant Pro.
--   2. Redefines public.ensure_trial_profile_for_new_user() so a NEW account is stamped with a 30-day
--      full-product window (trial_started_at = now(), trial_expires_at = now() + 30 days).
--   3. One-time ACTIVATION stamp (non-retroactive): every CURRENT unpaid account with no live window
--      gets a fresh 30-day window starting now. Guarded + idempotent (skips paid accounts and accounts
--      that already have a live window).
--   4. Restores a 30-day DEFAULT on the trial_expires_at columns for defence-in-depth.
--
-- Enforcement of the EXPIRED state (fail-closed: no new recording/persistence/analysis; read/export/
-- account-management/upgrade stay available) is slice 2 (public.check_usage_limit). This slice leaves
-- the existing check_usage_limit path intact: because it already routes through
-- effective_subscription_tier(..., trial_expires_at, ...), a live trial now yields 'pro' and full
-- product automatically; expired accounts fall back to the current behaviour until slice 2 hardens it.
--
-- Applying this migration activates NO billing and charges nothing. It only re-shapes entitlement.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Entitlement resolver — add the LIVE-trial branch (keep paid invariant + 4-arg signature).
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
    -- #1282: a LIVE 30-day full-product trial resolves to 'pro' WITHOUT a Stripe subscription. Only an
    -- unexpired window grants access; expired windows fall through to 'free'. Billing-portal access is
    -- gated separately on stripe_subscription_id, so trial users correctly get full product but no
    -- billing management (they have no subscription to manage).
    WHEN p_trial_expires_at IS NOT NULL AND p_trial_expires_at > now()
    THEN 'pro'
    ELSE 'free'
  END;
$$;

COMMENT ON FUNCTION public.effective_subscription_tier(TEXT, TIMESTAMPTZ, TEXT, TEXT) IS
  '#1282 entitlement tier. Full product (pro) when EITHER paid (subscription_status=pro AND a real '
  'stripe_subscription_id) OR inside a live 30-day trial (trial_expires_at > now()). Otherwise free. '
  'The legacy subscription_id (4th arg) is deprecated and ignored.';

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
    trial_expires_at
  )
  VALUES (
    NEW.id,
    'free',
    300,
    0,
    now(),
    now() + interval '30 days'
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
    updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_trial_profile_for_new_user() FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. One-time ACTIVATION stamp for existing unpaid beta accounts (non-retroactive; decision: PO).
--    Every current unpaid account with no LIVE window starts a fresh 30-day full-product trial now.
--    Idempotent: skips paid accounts and skips accounts that already have a live (future) window.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE public.user_profiles
SET trial_started_at = now(),
    trial_expires_at = now() + interval '30 days',
    updated_at = now()
WHERE (trial_expires_at IS NULL OR trial_expires_at <= now())
  AND NOT (
    lower(COALESCE(subscription_status, 'free')) = 'pro'
    AND NULLIF(trim(COALESCE(stripe_subscription_id, '')), '') IS NOT NULL
  );

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Defence-in-depth: restore a 30-day DEFAULT on the trial window columns (dropped by 20260610).
--    Provisioning above is explicit; this default only backstops any direct insert path.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ALTER COLUMN trial_expires_at SET DEFAULT (now() + interval '30 days');

ALTER TABLE public.trial_entitlements
  ALTER COLUMN trial_expires_at SET DEFAULT (now() + interval '30 days');
