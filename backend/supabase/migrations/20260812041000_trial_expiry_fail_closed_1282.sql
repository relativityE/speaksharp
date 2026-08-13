-- #1282 / #1266 — 30-day trial lifecycle, slice 2: EXPIRED state fails closed (post-prerequisite).
--
-- Slice 1 restored a live 30-day trial (effective_subscription_tier -> 'pro' inside the window) and a
-- one-time activation stamp. Because the usage RPCs already resolve entitlement through
-- effective_subscription_tier(..., trial_expires_at, ...), a live trial or a paid subscription both
-- yield effective 'pro' and get the full product automatically.
--
-- This slice hardens the EXPIRED/unpaid state. Per the #1266 contract (PO decision: fully fail closed),
-- once the 30-day trial expires and the account is unpaid (effective tier 'free'), NEW
-- recording/persistence/analysis is refused entirely. Reading existing sessions, PDF export, account
-- management, billing portal and upgrade all use OTHER paths (they do not call these usage RPCs) and
-- remain available. The prior 300-second private-sample fallback is retired for this model.
--
-- Only the two GATE functions change: update_user_usage (write path) and check_usage_limit (pre-flight).
-- create_session_and_update_usage and heartbeat_session call update_user_usage and propagate its
-- 'trial_expired' failure. complete_session independently rechecks entitlement at persistence time.
--
-- Applying this migration activates no billing and charges nothing.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- update_user_usage — fail closed for expired accounts; active trial/paid share unlimited accumulated
-- use and exactly one customer engine. Counters remain telemetry only.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_user_usage(
  p_session_duration_seconds INT,
  p_engine_type TEXT DEFAULT 'native',
  p_session_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_effective_tier TEXT;
  v_daily_usage INT;
  v_native_usage INT;
  v_cloud_usage INT;
  v_last_daily_reset TIMESTAMPTZ;
  v_last_monthly_reset TIMESTAMPTZ;
  v_allowed_engines TEXT[];
  v_today DATE := now()::DATE;
  v_reset_changed BOOLEAN := false;
  v_engine TEXT := lower(trim(COALESCE(p_engine_type, '')));
  v_is_cloud_engine BOOLEAN;
BEGIN
  IF p_session_duration_seconds IS NULL OR p_session_duration_seconds < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_duration');
  END IF;

  IF v_engine = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_engine');
  END IF;

  v_is_cloud_engine := v_engine = 'cloud';

  SELECT
    public.effective_subscription_tier(
      subscription_status,
      trial_expires_at,
      stripe_subscription_id,
      subscription_id,
      commercial_trial_granted_at
    ),
    COALESCE(daily_usage_seconds, 0),
    COALESCE(native_usage_seconds, 0),
    COALESCE(cloud_usage_seconds, 0),
    last_daily_reset,
    usage_reset_date
  INTO
    v_effective_tier,
    v_daily_usage,
    v_native_usage,
    v_cloud_usage,
    v_last_daily_reset,
    v_last_monthly_reset
  FROM public.user_profiles
  WHERE id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  -- #1282 FAIL CLOSED. Full product is available only inside a live 30-day trial or with a paid
  -- subscription (both -> effective 'pro'). Expired + unpaid (-> 'free') cannot start/extend a
  -- recording. This replaces the retired 300s private-sample fallback.
  IF COALESCE(v_effective_tier, 'free') <> 'pro' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'trial_expired',
      'subscription_status', v_effective_tier
    );
  END IF;

  SELECT allowed_engines
  INTO v_allowed_engines
  FROM public.tier_configs
  WHERE tier_name = COALESCE(v_effective_tier, 'free');

  IF v_allowed_engines IS NULL THEN
    v_allowed_engines := ARRAY['private']::TEXT[];
  END IF;

  IF v_last_daily_reset IS NULL OR v_last_daily_reset::DATE < v_today THEN
    v_daily_usage := 0;
    v_last_daily_reset := now();
    v_reset_changed := true;
  END IF;

  IF v_last_monthly_reset IS NULL OR v_last_monthly_reset <= now() - interval '1 month' THEN
    v_native_usage := 0;
    v_cloud_usage := 0;
    v_last_monthly_reset := now();
    v_reset_changed := true;
  END IF;

  IF v_reset_changed THEN
    UPDATE public.user_profiles
    SET
      daily_usage_seconds = v_daily_usage,
      native_usage_seconds = v_native_usage,
      cloud_usage_seconds = v_cloud_usage,
      last_daily_reset = v_last_daily_reset,
      usage_reset_date = v_last_monthly_reset,
      usage_seconds = v_native_usage + v_cloud_usage,
      updated_at = now()
    WHERE id = auth.uid();
  END IF;

  IF NOT (v_engine = ANY(v_allowed_engines)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'engine_not_allowed_for_tier',
      'subscription_status', v_effective_tier
    );
  END IF;

  v_daily_usage := v_daily_usage + p_session_duration_seconds;

  IF v_is_cloud_engine THEN
    v_cloud_usage := v_cloud_usage + p_session_duration_seconds;
  ELSE
    v_native_usage := v_native_usage + p_session_duration_seconds;
  END IF;

  UPDATE public.user_profiles
  SET
    daily_usage_seconds = v_daily_usage,
    native_usage_seconds = v_native_usage,
    cloud_usage_seconds = v_cloud_usage,
    last_daily_reset = v_last_daily_reset,
    usage_reset_date = v_last_monthly_reset,
    usage_seconds = v_native_usage + v_cloud_usage,
    updated_at = now()
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'daily_used', v_daily_usage,
    'daily_limit', -1,
    'monthly_used', v_native_usage + v_cloud_usage,
    'monthly_limit', -1,
    'subscription_status', v_effective_tier,
    -- Retired for the trial model; kept in the shape as null so callers that read it don't break.
    'private_sample_seconds_remaining', NULL
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- check_usage_limit — pre-flight. Non-'pro' cannot start (fail closed); surface real trial state.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_usage_limit()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stored_status TEXT;
  v_effective_tier TEXT;
  v_daily_usage INT;
  v_native_usage INT;
  v_cloud_usage INT;
  v_last_daily_reset TIMESTAMPTZ;
  v_last_monthly_reset TIMESTAMPTZ;
  v_trial_expires_at TIMESTAMPTZ;
  v_is_paid BOOLEAN;
  v_trial_active BOOLEAN;
BEGIN
  SELECT
    subscription_status,
    public.effective_subscription_tier(
      subscription_status,
      trial_expires_at,
      stripe_subscription_id,
      subscription_id,
      commercial_trial_granted_at
    ),
    COALESCE(daily_usage_seconds, 0),
    COALESCE(native_usage_seconds, 0),
    COALESCE(cloud_usage_seconds, 0),
    last_daily_reset,
    usage_reset_date,
    trial_expires_at,
    (lower(COALESCE(subscription_status, 'free')) = 'pro'
      AND NULLIF(trim(COALESCE(stripe_subscription_id, '')), '') IS NOT NULL)
  INTO
    v_stored_status,
    v_effective_tier,
    v_daily_usage,
    v_native_usage,
    v_cloud_usage,
    v_last_daily_reset,
    v_last_monthly_reset,
    v_trial_expires_at,
    v_is_paid
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    -- Fail closed on a missing profile (the signup trigger provisions one; absence is anomalous).
    RETURN jsonb_build_object(
      'can_start', false,
      'daily_remaining', 0,
      'daily_limit', -1,
      'monthly_remaining', 0,
      'monthly_limit', -1,
      'remaining_seconds', 0,
      'limit_seconds', -1,
      'used_seconds', 0,
      'subscription_status', 'free',
      'stored_subscription_status', 'unknown',
      'is_pro', false,
      'trial_active', false,
      'trial_expires_at', NULL,
      'trial_seconds_remaining', 0,
      'private_sample_available', false,
      'private_sample_seconds_remaining', 0,
      'error', 'profile_not_found'
    );
  END IF;

  IF v_last_daily_reset IS NULL OR v_last_daily_reset::DATE < now()::DATE THEN
    v_daily_usage := 0;
  END IF;

  IF v_last_monthly_reset IS NULL OR v_last_monthly_reset <= now() - interval '1 month' THEN
    v_native_usage := 0;
    v_cloud_usage := 0;
  END IF;

  -- A live trial is effective 'pro' but NOT paid. Distinguish it for the UI countdown.
  v_trial_active := (v_effective_tier = 'pro' AND NOT v_is_paid
    AND v_trial_expires_at IS NOT NULL AND v_trial_expires_at > now());

  -- #1282 FAIL CLOSED: only 'pro' (live trial or paid) may start a recording.
  IF COALESCE(v_effective_tier, 'free') <> 'pro' THEN
    RETURN jsonb_build_object(
      'can_start', false,
      'daily_remaining', 0,
      'daily_limit', -1,
      'monthly_remaining', 0,
      'monthly_limit', -1,
      'remaining_seconds', 0,
      'limit_seconds', -1,
      'used_seconds', v_daily_usage,
      'subscription_status', v_effective_tier,
      'stored_subscription_status', v_stored_status,
      'is_pro', false,
      'trial_active', false,
      'trial_expires_at', v_trial_expires_at,
      'trial_seconds_remaining', 0,
      'private_sample_available', false,
      'private_sample_seconds_remaining', 0,
      'error', 'trial_expired'
    );
  END IF;

  RETURN jsonb_build_object(
    'can_start', true,
    'daily_remaining', -1,
    'daily_limit', -1,
    'monthly_remaining', -1,
    'monthly_limit', -1,
    'remaining_seconds', -1,
    'limit_seconds', -1,
    'used_seconds', v_daily_usage,
    'subscription_status', v_effective_tier,
    'stored_subscription_status', v_stored_status,
    'is_pro', true,
    'trial_active', v_trial_active,
    'trial_expires_at', v_trial_expires_at,
    'trial_seconds_remaining', CASE
      WHEN v_trial_active THEN GREATEST(0, EXTRACT(EPOCH FROM (v_trial_expires_at - now()))::INT)
      ELSE 0
    END,
    'private_sample_available', false,
    'private_sample_seconds_remaining', 0
  );
END;
$$;

-- complete_session — expiry is checked again at persistence time. A recording that reaches the exact
-- server-side expiry boundary cannot be saved or analyzed. The shared 600-second per-recording technical
-- safety cap remains identical for trial and paid accounts and is unrelated to accumulated usage.
CREATE OR REPLACE FUNCTION public.complete_session(
    p_session_id UUID,
    p_status TEXT DEFAULT 'completed',
    p_final_transcript TEXT DEFAULT NULL,
    p_final_duration INT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session public.sessions%ROWTYPE;
    v_effective_tier TEXT;
    v_final_duration INT;
    v_retention JSONB;
BEGIN
    -- Preserve the established profile -> session lock order.
    SELECT public.effective_subscription_tier(
        subscription_status,
        trial_expires_at,
        stripe_subscription_id,
        subscription_id,
        commercial_trial_granted_at
    )
    INTO v_effective_tier
    FROM public.user_profiles
    WHERE id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
    END IF;

    SELECT * INTO v_session
    FROM public.sessions
    WHERE id = p_session_id AND user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
    END IF;

    IF COALESCE(v_effective_tier, 'free') <> 'pro' THEN
        RETURN jsonb_build_object('success', false, 'error', 'trial_expired');
    END IF;

    v_final_duration := LEAST(600, GREATEST(0, COALESCE(p_final_duration, v_session.duration, 0)));

    UPDATE public.sessions
    SET status = p_status,
        status_reason = COALESCE(p_reason, status_reason),
        transcript = COALESCE(p_final_transcript, transcript),
        duration = v_final_duration,
        updated_at = now()
    WHERE id = p_session_id AND user_id = auth.uid();

    BEGIN
        v_retention := public.converge_transcript_retention(auth.uid());
    EXCEPTION
        WHEN query_canceled THEN
            v_retention := jsonb_build_object('status', 'error');
        WHEN OTHERS THEN
            v_retention := jsonb_build_object('status', 'error');
    END;

    RETURN jsonb_build_object(
        'success', true,
        'final_status', p_status,
        'private_sample_completed', false,
        'retention', v_retention
    );
END;
$$;

-- Re-apply ACLs (CREATE OR REPLACE preserves grants, but restate for explicit provenance).
-- #1282 blocker 4: preserve the #1276/#1261 SECURITY DEFINER hardening — least-privilege revoke
-- (PUBLIC + anon) before the required grants, matching search_path = public, pg_temp above.
REVOKE EXECUTE ON FUNCTION public.update_user_usage(INT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_user_usage(INT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_usage(INT, TEXT, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_usage_limit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_usage_limit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_usage_limit() TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- #1282 blocker 6: Private-only entitlement gate. A live trial and a paid account both resolve to the
-- effective 'pro' tier, which must NOT inherit the old Pro engine allowances (Browser/Cloud/Native). The
-- customer path negotiates the 'private' engine token; update_user_usage gates recording on
-- tier_configs.allowed_engines for the effective tier, so the paid/trial allow-list is restricted to the
  -- Private engine token ONLY. Cloud and Browser are not customer entitlements (per the
-- #1254/#1269 Private-only truth); 'native' remains solely an internal deterministic E2E hook and is NOT a
-- customer entitlement here.
UPDATE public.tier_configs
SET allowed_engines = ARRAY['private']::text[]
WHERE tier_name = 'pro';
