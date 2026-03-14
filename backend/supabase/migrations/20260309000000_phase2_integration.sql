-- backend/supabase/migrations/20260309000000_phase2_integration.sql

-- 1. Create Tier Configuration Table (Enhanced)
CREATE TABLE IF NOT EXISTS public.tier_configs (
    tier_name TEXT PRIMARY KEY,
    daily_limit_seconds INT NOT NULL,
    monthly_limit_seconds INT NOT NULL,
    max_session_seconds INT DEFAULT 3600,
    max_concurrent_sessions INT DEFAULT 1,
    allowed_engines TEXT[] DEFAULT '{"native", "transformers-js", "whisper-turbo"}'::TEXT[],
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Seed Tier Configurations (Sync with PRD)
INSERT INTO public.tier_configs (tier_name, daily_limit_seconds, monthly_limit_seconds, max_concurrent_sessions, allowed_engines)
VALUES 
    ('free', 3600, 90000, 1, '{"native", "transformers-js", "whisper-turbo"}')
ON CONFLICT (tier_name) DO UPDATE SET
    daily_limit_seconds = EXCLUDED.daily_limit_seconds,
    monthly_limit_seconds = EXCLUDED.monthly_limit_seconds,
    max_concurrent_sessions = EXCLUDED.max_concurrent_sessions,
    allowed_engines = EXCLUDED.allowed_engines;

INSERT INTO public.tier_configs (tier_name, daily_limit_seconds, monthly_limit_seconds, max_concurrent_sessions, allowed_engines)
VALUES 
    ('pro', 7200, 180000, 3, '{"native", "transformers-js", "whisper-turbo", "cloud"}')
ON CONFLICT (tier_name) DO UPDATE SET
    daily_limit_seconds = EXCLUDED.daily_limit_seconds,
    monthly_limit_seconds = EXCLUDED.monthly_limit_seconds,
    max_concurrent_sessions = EXCLUDED.max_concurrent_sessions,
    allowed_engines = EXCLUDED.allowed_engines;

-- 3. Enhance Sessions Table for Production Safeguards
ALTER TABLE public.sessions 
ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS engine_version TEXT,
ADD COLUMN IF NOT EXISTS model_name TEXT,
ADD COLUMN IF NOT EXISTS device_type TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'; -- active, completed, expired

-- 4. Create Usage Logs Table for Heartbeats
CREATE TABLE IF NOT EXISTS public.usage_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id),
    incremental_seconds INT NOT NULL,
    engine_type TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_checkpoints_session ON public.usage_checkpoints(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_checkpoints_user_date ON public.usage_checkpoints(user_id, created_at);

-- 5. Refactor update_user_usage to handle heartbeats and dynamic limits
CREATE OR REPLACE FUNCTION public.update_user_usage(
  p_session_duration_seconds INT,
  p_engine_type TEXT DEFAULT 'native'
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
  
  v_daily_limit INT;
  v_monthly_limit INT;
  v_allowed_engines TEXT[];
  
  v_today DATE := now()::DATE;
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

  -- 2. Fetch Dynamic Limits
  SELECT daily_limit_seconds, monthly_limit_seconds, allowed_engines
  INTO v_daily_limit, v_monthly_limit, v_allowed_engines
  FROM public.tier_configs
  WHERE tier_name = COALESCE(v_user_status, 'free');

  -- Fallback
  IF v_daily_limit IS NULL THEN
    v_daily_limit := 3600;
    v_monthly_limit := 90000;
    v_allowed_engines := '{"native", "transformers-js", "whisper-turbo"}';
  END IF;

  -- 3. Engine Authorization
  IF NOT (p_engine_type = ANY(v_allowed_engines)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'engine_not_allowed_for_tier');
  END IF;

  -- 4. Reset Logic
  IF v_last_daily_reset::DATE < v_today THEN
    v_daily_usage := 0;
    v_last_daily_reset := now();
  END IF;

  IF v_last_monthly_reset IS NULL OR v_last_monthly_reset <= now() - interval '1 month' THEN
    v_native_usage := 0;
    v_cloud_usage := 0;
    v_last_monthly_reset := now();
  END IF;

  -- 5. Enforce Limits
  IF v_daily_usage >= v_daily_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'daily_limit_reached');
  END IF;

  -- 6. Perform Increments
  v_daily_usage := v_daily_usage + p_session_duration_seconds;
  
  IF p_engine_type = 'cloud' THEN
    v_cloud_usage := v_cloud_usage + p_session_duration_seconds;
  ELSE
    v_native_usage := v_native_usage + p_session_duration_seconds;
  END IF;

  -- 7. Update User Profile
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
    'daily_limit', v_daily_limit
  );
END;
$$;

-- 6. Refined Create Session RPC with Idempotency and Concurrency Guards
CREATE OR REPLACE FUNCTION public.create_session_and_update_usage(
    p_session_data JSONB,
    p_engine_type TEXT DEFAULT 'native',
    p_idempotency_key UUID DEFAULT NULL,
    p_engine_version TEXT DEFAULT NULL,
    p_model_name TEXT DEFAULT NULL,
    p_device_type TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_session_id UUID;
    v_new_session_id UUID;
    v_duration INT;
    v_usage_check JSONB;
    v_user_tier TEXT;
    v_max_concurrent INT;
    v_active_sessions INT;
BEGIN
    -- 0. Set local timeout
    SET LOCAL statement_timeout = '3000ms';

    -- 1. Idempotency Check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing_session_id 
        FROM public.sessions 
        WHERE idempotency_key = p_idempotency_key AND user_id = auth.uid();
        
        IF v_existing_session_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_existing_session_id),
                'usage_exceeded', false,
                'is_duplicate', true
            );
        END IF;
    END IF;

    -- 2. Atomic Concurrency & Usage Lock
    -- This locks the user profile and counts active sessions in a single transaction path
    SELECT 
        up.subscription_status,
        tc.max_concurrent_sessions
    INTO 
        v_user_tier,
        v_max_concurrent
    FROM public.user_profiles up
    JOIN public.tier_configs tc ON tc.tier_name = COALESCE(up.subscription_status, 'free')
    WHERE up.id = auth.uid()
    FOR UPDATE; -- Prevents multiple session creations racing for the same user

    SELECT COUNT(*) INTO v_active_sessions 
    FROM public.sessions 
    WHERE user_id = auth.uid() AND status = 'active';
    
    IF v_active_sessions >= v_max_concurrent THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', 'max_concurrent_sessions_reached'
        );
    END IF;

    -- 3. Initial Duration Setup (Usually starts small or with estimated time)
    v_duration := COALESCE((p_session_data->>'duration')::INT, 0);
    
    -- 4. Initial Usage Check (Inside the lock)
    v_usage_check := update_user_usage(v_duration, p_engine_type);
    
    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', v_usage_check->>'error'
        );
    END IF;

    -- 5. Insert Session
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
        wpm,
        idempotency_key,
        engine_version,
        model_name,
        device_type,
        status,
        expires_at
    ) VALUES (
        auth.uid(),
        p_session_data->>'title',
        v_duration,
        COALESCE((p_session_data->>'total_words')::INT, 0),
        COALESCE((p_session_data->'filler_words')::JSONB, '{}'::JSONB),
        (p_session_data->>'accuracy')::FLOAT8,
        p_session_data->>'ground_truth',
        p_session_data->>'transcript',
        p_engine_type,
        (p_session_data->>'clarity_score')::FLOAT8,
        (p_session_data->>'wpm')::FLOAT8,
        p_idempotency_key,
        p_engine_version,
        p_model_name,
        p_device_type,
        'active',
        now() + interval '1 hour' -- Default expiry
    ) RETURNING id INTO v_new_session_id;

    -- 6. Log Initial Usage Checkpoint
    IF v_duration > 0 THEN
        INSERT INTO public.usage_checkpoints (session_id, user_id, incremental_seconds, engine_type)
        VALUES (v_new_session_id, auth.uid(), v_duration, p_engine_type);
    END IF;

    RETURN jsonb_build_object(
        'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_new_session_id),
    'usage_exceeded', false
    );
END;
$$;

-- backend/supabase/migrations/20260309000000_integration.sql
-- This function marks sessions as 'completed' if they haven't sent a heartbeat within the timeout.
CREATE OR REPLACE FUNCTION public.expire_stale_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.sessions
    SET status = 'completed',
        expires_at = NULL
    WHERE status = 'active'
      AND (expires_at < now() OR updated_at < now() - interval '5 minutes');
END;
$$;

-- Note: In a production Supabase environment, you would schedule this via pg_cron:
-- SELECT cron.schedule('*/5 * * * *', 'SELECT public.expire_stale_sessions()');

-- 7. Heartbeat RPC for Incremental Usage Tracking
CREATE OR REPLACE FUNCTION public.heartbeat_session(
    p_session_id UUID,
    p_incremental_seconds INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_usage_check JSONB;
    v_engine_type TEXT;
BEGIN
    -- 1. Get Session Info
    SELECT engine INTO v_engine_type FROM public.sessions WHERE id = p_session_id AND user_id = auth.uid();
    
    IF v_engine_type IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
    END IF;

    -- 2. Update Total Usage (Atomic)
    v_usage_check := update_user_usage(p_incremental_seconds, v_engine_type);
    
    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object('success', false, 'error', v_usage_check->>'error');
    END IF;

    -- 3. Update Session Expiry and Cumulative Duration
    UPDATE public.sessions 
    SET 
        duration = duration + p_incremental_seconds,
        expires_at = now() + interval '5 minutes', -- Extend expiry
        updated_at = now()
    WHERE id = p_session_id;

    -- 4. Log Checkpoint
    INSERT INTO public.usage_checkpoints (session_id, user_id, incremental_seconds, engine_type)
    VALUES (p_session_id, auth.uid(), p_incremental_seconds, v_engine_type);

    RETURN jsonb_build_object('success', true);
END;
$$;
