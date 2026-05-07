-- Fail-closed usage guards for launch readiness.
-- Prevent negative duration writes and enforce quota on the mutation path.

ALTER TABLE public.sessions
DROP CONSTRAINT IF EXISTS sessions_duration_non_negative;

ALTER TABLE public.sessions
ADD CONSTRAINT sessions_duration_non_negative
CHECK (duration IS NULL OR duration >= 0) NOT VALID;

ALTER TABLE public.user_profiles
DROP CONSTRAINT IF EXISTS user_profiles_usage_non_negative;

ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_usage_non_negative
CHECK (
  COALESCE(usage_seconds, 0) >= 0
  AND COALESCE(daily_usage_seconds, 0) >= 0
  AND COALESCE(native_usage_seconds, 0) >= 0
  AND COALESCE(cloud_usage_seconds, 0) >= 0
) NOT VALID;

ALTER TABLE public.usage_checkpoints
DROP CONSTRAINT IF EXISTS usage_checkpoints_incremental_seconds_non_negative;

ALTER TABLE public.usage_checkpoints
ADD CONSTRAINT usage_checkpoints_incremental_seconds_non_negative
CHECK (incremental_seconds >= 0) NOT VALID;

CREATE OR REPLACE FUNCTION public.update_user_usage(
  p_session_duration_seconds INT,
  p_engine_type TEXT DEFAULT 'native'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_status TEXT;
  v_daily_usage INT;
  v_native_usage INT;
  v_cloud_usage INT;
  v_last_daily_reset TIMESTAMPTZ;
  v_last_monthly_reset TIMESTAMPTZ;

  v_daily_limit INT;
  v_monthly_limit INT;
  v_allowed_engines TEXT[];

  v_today DATE := now()::DATE;
BEGIN
  IF p_session_duration_seconds IS NULL OR p_session_duration_seconds < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_duration');
  END IF;

  IF p_engine_type IS NULL OR p_engine_type = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_engine');
  END IF;

  SELECT
    subscription_status,
    COALESCE(daily_usage_seconds, 0),
    COALESCE(native_usage_seconds, 0),
    COALESCE(cloud_usage_seconds, 0),
    last_daily_reset,
    usage_reset_date
  INTO
    v_user_status,
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

  SELECT daily_limit_seconds, monthly_limit_seconds, allowed_engines
  INTO v_daily_limit, v_monthly_limit, v_allowed_engines
  FROM public.tier_configs
  WHERE tier_name = COALESCE(v_user_status, 'free');

  IF v_daily_limit IS NULL THEN
    v_daily_limit := 3600;
    v_monthly_limit := 90000;
    v_allowed_engines := '{"native", "transformers-js", "whisper-turbo"}';
  END IF;

  IF NOT (p_engine_type = ANY(v_allowed_engines)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'engine_not_allowed_for_tier');
  END IF;

  IF v_last_daily_reset IS NULL OR v_last_daily_reset::DATE < v_today THEN
    v_daily_usage := 0;
    v_last_daily_reset := now();
  END IF;

  IF v_last_monthly_reset IS NULL OR v_last_monthly_reset <= now() - interval '1 month' THEN
    v_native_usage := 0;
    v_cloud_usage := 0;
    v_last_monthly_reset := now();
  END IF;

  IF v_daily_usage + p_session_duration_seconds > v_daily_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'daily_limit_reached');
  END IF;

  IF v_native_usage + v_cloud_usage + p_session_duration_seconds > v_monthly_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'monthly_limit_reached');
  END IF;

  v_daily_usage := v_daily_usage + p_session_duration_seconds;

  IF p_engine_type = 'cloud' THEN
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
    'daily_limit', v_daily_limit,
    'monthly_used', v_native_usage + v_cloud_usage,
    'monthly_limit', v_monthly_limit
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_session(
    p_session_id UUID,
    p_incremental_seconds INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usage_check JSONB;
    v_engine_type TEXT;
BEGIN
    IF p_incremental_seconds IS NULL OR p_incremental_seconds < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_duration');
    END IF;

    SELECT engine INTO v_engine_type
    FROM public.sessions
    WHERE id = p_session_id AND user_id = auth.uid();

    IF v_engine_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
    END IF;

    v_usage_check := update_user_usage(p_incremental_seconds, v_engine_type);

    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object('success', false, 'error', v_usage_check->>'error');
    END IF;

    UPDATE public.sessions
    SET
        duration = duration + p_incremental_seconds,
        expires_at = now() + interval '5 minutes',
        updated_at = now()
    WHERE id = p_session_id AND user_id = auth.uid();

    INSERT INTO public.usage_checkpoints (session_id, user_id, incremental_seconds, engine_type)
    VALUES (p_session_id, auth.uid(), p_incremental_seconds, v_engine_type);

    RETURN jsonb_build_object('success', true);
END;
$$;
