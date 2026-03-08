-- backend/supabase/migrations/20260301000000_usage_limits_hardening.sql

-- 1. Add private_usage_seconds to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS private_usage_seconds INT DEFAULT 0;

-- 2. Update update_user_usage to handle 'private' engine and refine limits
CREATE OR REPLACE FUNCTION public.update_user_usage(
  session_duration_seconds INT,
  engine_type TEXT DEFAULT 'native' -- 'native', 'cloud', or 'private'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_status TEXT;
  v_daily_usage INT;
  v_native_usage INT;
  v_cloud_usage INT;
  v_private_usage INT;
  v_last_daily_reset TIMESTAMPTZ;
  v_last_monthly_reset TIMESTAMPTZ;

  -- Limits
  v_daily_limit_free INT := 3600;      -- 1 Hour
  v_daily_limit_pro INT := 7200;       -- 2 Hours
  v_monthly_limit_free INT := 90000;   -- 25 Hours
  v_monthly_limit_pro INT := 180000;   -- 50 Hours

  v_current_daily_limit INT;
  v_current_monthly_limit INT;
  v_total_monthly_usage INT;
BEGIN
  -- 1. Get current state with Row Lock
  SELECT
    subscription_status,
    daily_usage_seconds,
    native_usage_seconds,
    cloud_usage_seconds,
    COALESCE(private_usage_seconds, 0),
    last_daily_reset,
    usage_reset_date
  INTO
    v_user_status,
    v_daily_usage,
    v_native_usage,
    v_cloud_usage,
    v_private_usage,
    v_last_daily_reset,
    v_last_monthly_reset
  FROM public.user_profiles
  WHERE id = auth.uid()
  FOR UPDATE;

  -- 2. Handle Daily Reset Logic
  IF v_last_daily_reset::DATE < now()::DATE THEN
    v_daily_usage := 0;
    v_last_daily_reset := now();
  END IF;

  -- 3. Handle Monthly Reset Logic
  IF v_last_monthly_reset IS NULL OR v_last_monthly_reset <= now() - interval '1 month' THEN
    v_native_usage := 0;
    v_cloud_usage := 0;
    v_private_usage := 0;
    v_last_monthly_reset := now();
  END IF;

  -- 4. Set applicable limits
  IF v_user_status = 'pro' THEN
    v_current_daily_limit := v_daily_limit_pro;
    v_current_monthly_limit := v_monthly_limit_pro;
  ELSE
    v_current_daily_limit := v_daily_limit_free;
    v_current_monthly_limit := v_monthly_limit_free;
  END IF;

  -- 5. Enforce Limits
  v_total_monthly_usage := v_native_usage + v_cloud_usage + v_private_usage;

  IF v_daily_usage >= v_current_daily_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'daily_limit_reached');
  END IF;

  IF v_total_monthly_usage >= v_current_monthly_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'monthly_limit_reached');
  END IF;

  -- 6. Perform Increments
  v_daily_usage := v_daily_usage + session_duration_seconds;

  IF engine_type = 'cloud' THEN
    v_cloud_usage := v_cloud_usage + session_duration_seconds;
  ELSIF engine_type = 'private' THEN
    v_private_usage := v_private_usage + session_duration_seconds;
  ELSE
    v_native_usage := v_native_usage + session_duration_seconds;
  END IF;

  -- 7. Update the DB
  UPDATE public.user_profiles
  SET
    daily_usage_seconds = v_daily_usage,
    native_usage_seconds = v_native_usage,
    cloud_usage_seconds = v_cloud_usage,
    private_usage_seconds = v_private_usage,
    last_daily_reset = v_last_daily_reset,
    usage_reset_date = v_last_monthly_reset,
    usage_seconds = v_native_usage + v_cloud_usage + v_private_usage,
    updated_at = now()
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'daily_used', v_daily_usage,
    'daily_limit', v_current_daily_limit,
    'monthly_used', v_native_usage + v_cloud_usage + v_private_usage,
    'monthly_limit', v_current_monthly_limit
  );
END;
$$;

-- 3. Update check_usage_limit
CREATE OR REPLACE FUNCTION public.check_usage_limit()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_status TEXT;
  v_daily_usage INT;
  v_native_usage INT;
  v_cloud_usage INT;
  v_private_usage INT;
  v_last_daily_reset TIMESTAMPTZ;
  v_last_monthly_reset TIMESTAMPTZ;

  v_daily_limit INT;
  v_monthly_limit INT;
  v_total_monthly_usage INT;
BEGIN
  SELECT
    subscription_status,
    daily_usage_seconds,
    native_usage_seconds,
    cloud_usage_seconds,
    COALESCE(private_usage_seconds, 0),
    last_daily_reset,
    usage_reset_date
  INTO
    v_user_status,
    v_daily_usage,
    v_native_usage,
    v_cloud_usage,
    v_private_usage,
    v_last_daily_reset,
    v_last_monthly_reset
  FROM public.user_profiles
  WHERE id = auth.uid();

  -- Apply virtual reset for display logic
  IF v_last_daily_reset::DATE < now()::DATE THEN
    v_daily_usage := 0;
  END IF;

  IF v_last_monthly_reset IS NULL OR v_last_monthly_reset <= now() - interval '1 month' THEN
    v_native_usage := 0;
    v_cloud_usage := 0;
    v_private_usage := 0;
  END IF;

  IF v_user_status = 'pro' THEN
    v_daily_limit := 7200;
    v_monthly_limit := 180000;
  ELSE
    v_daily_limit := 3600;
    v_monthly_limit := 90000;
  END IF;

  v_total_monthly_usage := v_native_usage + v_cloud_usage + v_private_usage;

  RETURN jsonb_build_object(
    'can_start', (v_daily_usage < v_daily_limit AND v_total_monthly_usage < v_monthly_limit),
    'daily_remaining', GREATEST(0, v_daily_limit - v_daily_usage),
    'daily_limit', v_daily_limit,
    'monthly_remaining', GREATEST(0, v_monthly_limit - v_total_monthly_usage),
    'monthly_limit', v_monthly_limit,
    'native_used', v_native_usage,
    'cloud_used', v_cloud_usage,
    'private_used', v_private_usage,
    'subscription_status', v_user_status,
    'is_pro', (v_user_status = 'pro'),
    'remaining_seconds', GREATEST(0, v_daily_limit - v_daily_usage) -- Keep legacy
  );
END;
$$;
