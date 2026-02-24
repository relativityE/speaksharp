-- backend/supabase/migrations/20260224000000_usage_tier_refactor.sql

-- 1. Add new tracking columns to user_profiles
ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS daily_usage_seconds INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS native_usage_seconds INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS cloud_usage_seconds INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_daily_reset TIMESTAMPTZ DEFAULT now();

-- 2. Update update_user_usage to handle engine types and daily resets
CREATE OR REPLACE FUNCTION public.update_user_usage(
  session_duration_seconds INT,
  engine_type TEXT DEFAULT 'native' -- 'native' or 'cloud'
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
  v_last_daily_reset TIMESTAMPTZ;
  v_last_monthly_reset TIMESTAMPTZ;
  
  -- Limits (Sync with PRD)
  v_daily_limit_free INT := 3600;      -- 1 Hour
  v_daily_limit_pro INT := 7200;       -- 2 Hours
  v_monthly_limit_free INT := 90000;   -- 25 Hours
  v_monthly_limit_pro INT := 180000;   -- 50 Hours
  
  v_current_daily_limit INT;
  v_current_monthly_limit INT;
BEGIN
  -- 1. Get current state with Row Lock
  SELECT 
    subscription_status, 
    daily_usage_seconds, 
    native_usage_seconds, 
    cloud_usage_seconds, 
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

  -- 2. Handle Daily Reset Logic (Time-zone aware)
  -- Reset if last_daily_reset is NOT the same calendar day as now()
  IF v_last_daily_reset::DATE < now()::DATE THEN
    v_daily_usage := 0;
    v_last_daily_reset := now();
  END IF;

  -- 3. Handle Monthly Reset Logic
  IF v_last_monthly_reset IS NULL OR v_last_monthly_reset <= now() - interval '1 month' THEN
    v_native_usage := 0;
    v_cloud_usage := 0;
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

  -- 5. Enforce Limits (Soft-check before increment)
  -- If they already hit daily limit, block.
  IF v_daily_usage >= v_current_daily_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'daily_limit_reached');
  END IF;

  -- 6. Perform Increments
  v_daily_usage := v_daily_usage + session_duration_seconds;
  
  IF engine_type = 'cloud' THEN
    v_cloud_usage := v_cloud_usage + session_duration_seconds;
  ELSE
    v_native_usage := v_native_usage + session_duration_seconds;
  END IF;

  -- 7. Update the DB
  UPDATE public.user_profiles
  SET
    daily_usage_seconds = v_daily_usage,
    native_usage_seconds = v_native_usage,
    cloud_usage_seconds = v_cloud_usage,
    last_daily_reset = v_last_daily_reset,
    usage_reset_date = v_last_monthly_reset,
    usage_seconds = v_native_usage + v_cloud_usage, -- Keep legacy column for backward compat
    updated_at = now()
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true, 
    'daily_used', v_daily_usage,
    'daily_limit', v_current_daily_limit
  );
END;
$$;

-- 3. Update check_usage_limit to return detailed metrics
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
  v_last_daily_reset TIMESTAMPTZ;
  v_last_monthly_reset TIMESTAMPTZ;
  
  v_daily_limit INT;
  v_monthly_limit INT;
BEGIN
  SELECT 
    subscription_status, 
    daily_usage_seconds, 
    native_usage_seconds, 
    cloud_usage_seconds, 
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
  WHERE id = auth.uid();

  -- Apply virtual reset for display logic
  IF v_last_daily_reset::DATE < now()::DATE THEN
    v_daily_usage := 0;
  END IF;

  IF v_last_monthly_reset IS NULL OR v_last_monthly_reset <= now() - interval '1 month' THEN
    v_native_usage := 0;
    v_cloud_usage := 0;
  END IF;

  IF v_user_status = 'pro' THEN
    v_daily_limit := 7200;
    v_monthly_limit := 180000;
  ELSE
    v_daily_limit := 3600;
    v_monthly_limit := 90000;
  END IF;

  RETURN jsonb_build_object(
    'can_start', (v_daily_usage < v_daily_limit AND (v_native_usage + v_cloud_usage) < v_monthly_limit),
    'daily_remaining', GREATEST(0, v_daily_limit - v_daily_usage),
    'daily_limit', v_daily_limit,
    'monthly_remaining', GREATEST(0, v_monthly_limit - (v_native_usage + v_cloud_usage)),
    'monthly_limit', v_monthly_limit,
    'subscription_status', v_user_status,
    'is_pro', (v_user_status = 'pro')
  );
END;
$$;

-- 4. Update create_session_and_update_usage to support engine-aware tracking
CREATE OR REPLACE FUNCTION public.create_session_and_update_usage(
    p_session_data JSONB,
    p_is_free_user BOOLEAN, -- Kept for signature compatibility
    p_engine_type TEXT DEFAULT 'native'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_session_id UUID;
    v_duration INT;
    v_usage_check JSONB;
    v_result JSONB;
BEGIN
    v_duration := (p_session_data->>'duration')::INT;
    
    -- Integration Safety Guard
    IF v_duration < 1 OR p_session_data->>'transcript' IS NULL OR p_session_data->>'transcript' = '' THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', false,
            'reason', 'Session too short or empty'
        );
    END IF;
    
    -- 1. Update Usage (Atomic)
    v_usage_check := update_user_usage(v_duration, p_engine_type);
    
    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', v_usage_check->>'error'
        );
    END IF;

    -- 2. Insert Session
    INSERT INTO public.sessions (
        user_id,
        title,
        duration,
        total_words,
        filler_words,
        accuracy,
        ground_truth,
        transcript,
        engine,
        clarity_score,
        wpm
    ) VALUES (
        auth.uid(),
        p_session_data->>'title',
        v_duration,
        (p_session_data->>'total_words')::INT,
        (p_session_data->'filler_words')::JSONB,
        (p_session_data->>'accuracy')::FLOAT8,
        p_session_data->>'ground_truth',
        p_session_data->>'transcript',
        p_session_data->>'engine',
        (p_session_data->>'clarity_score')::FLOAT8,
        (p_session_data->>'wpm')::FLOAT8
    ) RETURNING id INTO v_new_session_id;

    -- 3. Prepare result
    SELECT jsonb_build_object(
        'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_new_session_id),
        'usage_exceeded', false
    ) INTO v_result;

    RETURN v_result;
END;
$$;
