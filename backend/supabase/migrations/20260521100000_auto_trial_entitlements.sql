-- Install automatic one-hour Pro trials.
-- The trial is keyed by normalized email so a person gets one trial window
-- even if profile creation is retried.

CREATE TABLE IF NOT EXISTS public.trial_entitlements (
  email TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  trial_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trial_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trial_entitlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access trial entitlements" ON public.trial_entitlements;
CREATE POLICY "Service role has full access trial entitlements"
  ON public.trial_entitlements
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;

INSERT INTO public.trial_entitlements (email, user_id, trial_started_at, trial_expires_at)
SELECT
  lower(trim(u.email)),
  u.id,
  COALESCE(up.trial_started_at, now()),
  COALESCE(up.trial_expires_at, now() + interval '60 minutes')
FROM auth.users u
LEFT JOIN public.user_profiles up ON up.id = u.id
WHERE u.email IS NOT NULL
ON CONFLICT (email) DO NOTHING;

UPDATE public.user_profiles up
SET
  trial_started_at = te.trial_started_at,
  trial_expires_at = te.trial_expires_at,
  updated_at = now()
FROM auth.users u
JOIN public.trial_entitlements te ON te.email = lower(trim(u.email))
WHERE up.id = u.id
  AND (up.trial_started_at IS NULL OR up.trial_expires_at IS NULL);

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
    WHEN NULLIF(p_stripe_subscription_id, '') IS NOT NULL
      OR NULLIF(p_subscription_id, '') IS NOT NULL
    THEN 'pro'
    WHEN p_trial_expires_at IS NOT NULL
      AND p_trial_expires_at > now()
    THEN 'pro'
    WHEN lower(COALESCE(p_subscription_status, 'basic')) = 'pro'
    THEN 'pro'
    ELSE 'basic'
  END;
$$;

COMMENT ON FUNCTION public.effective_subscription_tier(TEXT, TIMESTAMPTZ, TEXT, TEXT) IS
  'Returns the effective tier for entitlement checks: paid Pro, active automatic trial, explicit Pro, otherwise Basic.';

CREATE OR REPLACE FUNCTION public.ensure_trial_profile_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(NEW.email));
  v_trial_started_at TIMESTAMPTZ;
  v_trial_expires_at TIMESTAMPTZ;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.trial_entitlements (email, user_id)
  VALUES (v_email, NEW.id)
  ON CONFLICT (email) DO UPDATE
  SET
    user_id = COALESCE(public.trial_entitlements.user_id, EXCLUDED.user_id),
    updated_at = now()
  RETURNING trial_started_at, trial_expires_at
  INTO v_trial_started_at, v_trial_expires_at;

  INSERT INTO public.user_profiles (
    id,
    subscription_status,
    trial_started_at,
    trial_expires_at,
    usage_seconds,
    usage_reset_date,
    updated_at
  )
  VALUES (
    NEW.id,
    'basic',
    v_trial_started_at,
    v_trial_expires_at,
    0,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    trial_started_at = COALESCE(public.user_profiles.trial_started_at, EXCLUDED.trial_started_at),
    trial_expires_at = COALESCE(public.user_profiles.trial_expires_at, EXCLUDED.trial_expires_at),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_trial_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_trial_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_trial_profile_for_new_user();

CREATE OR REPLACE FUNCTION public.check_usage_limit()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored_status TEXT;
  v_effective_tier TEXT;
  v_daily_usage INT;
  v_native_usage INT;
  v_cloud_usage INT;
  v_last_daily_reset TIMESTAMPTZ;
  v_last_monthly_reset TIMESTAMPTZ;
  v_daily_limit INT;
  v_monthly_limit INT;
  v_trial_started_at TIMESTAMPTZ;
  v_trial_expires_at TIMESTAMPTZ;
BEGIN
  SELECT
    subscription_status,
    public.effective_subscription_tier(
      subscription_status,
      trial_expires_at,
      stripe_subscription_id,
      subscription_id
    ),
    COALESCE(daily_usage_seconds, 0),
    COALESCE(native_usage_seconds, 0),
    COALESCE(cloud_usage_seconds, 0),
    last_daily_reset,
    usage_reset_date,
    trial_started_at,
    trial_expires_at
  INTO
    v_stored_status,
    v_effective_tier,
    v_daily_usage,
    v_native_usage,
    v_cloud_usage,
    v_last_daily_reset,
    v_last_monthly_reset,
    v_trial_started_at,
    v_trial_expires_at
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    SELECT daily_limit_seconds, monthly_limit_seconds
    INTO v_daily_limit, v_monthly_limit
    FROM public.tier_configs
    WHERE tier_name = 'basic';

    RETURN jsonb_build_object(
      'can_start', true,
      'daily_remaining', COALESCE(v_daily_limit, 3600),
      'daily_limit', COALESCE(v_daily_limit, 3600),
      'monthly_remaining', COALESCE(v_monthly_limit, 90000),
      'monthly_limit', COALESCE(v_monthly_limit, 90000),
      'remaining_seconds', COALESCE(v_daily_limit, 3600),
      'limit_seconds', COALESCE(v_daily_limit, 3600),
      'used_seconds', 0,
      'subscription_status', 'basic',
      'stored_subscription_status', 'unknown',
      'is_pro', false,
      'trial_active', false,
      'error', 'Profile not found'
    );
  END IF;

  IF lower(COALESCE(v_stored_status, '')) = 'free' THEN
    UPDATE public.user_profiles
    SET subscription_status = 'basic', updated_at = now()
    WHERE id = auth.uid();
    v_stored_status := 'basic';
  END IF;

  IF v_last_daily_reset IS NULL OR v_last_daily_reset::DATE < now()::DATE THEN
    v_daily_usage := 0;
  END IF;

  IF v_last_monthly_reset IS NULL OR v_last_monthly_reset <= now() - interval '1 month' THEN
    v_native_usage := 0;
    v_cloud_usage := 0;
  END IF;

  SELECT daily_limit_seconds, monthly_limit_seconds
  INTO v_daily_limit, v_monthly_limit
  FROM public.tier_configs
  WHERE tier_name = COALESCE(v_effective_tier, 'basic');

  IF v_daily_limit IS NULL THEN
    v_daily_limit := 3600;
    v_monthly_limit := 90000;
  END IF;

  RETURN jsonb_build_object(
    'can_start', (v_daily_usage < v_daily_limit AND (v_native_usage + v_cloud_usage) < v_monthly_limit),
    'daily_remaining', GREATEST(0, v_daily_limit - v_daily_usage),
    'daily_limit', v_daily_limit,
    'monthly_remaining', GREATEST(0, v_monthly_limit - (v_native_usage + v_cloud_usage)),
    'monthly_limit', v_monthly_limit,
    'remaining_seconds', GREATEST(0, v_daily_limit - v_daily_usage),
    'limit_seconds', v_daily_limit,
    'used_seconds', v_daily_usage,
    'subscription_status', v_effective_tier,
    'stored_subscription_status', v_stored_status,
    'is_pro', (v_effective_tier = 'pro'),
    'trial_active', (v_trial_expires_at IS NOT NULL AND v_trial_expires_at > now()),
    'trial_started_at', v_trial_started_at,
    'trial_expires_at', v_trial_expires_at,
    'trial_seconds_remaining', CASE
      WHEN v_trial_expires_at IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM (v_trial_expires_at - now()))::INT)
      ELSE 0
    END
  );
END;
$$;

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
  v_effective_tier TEXT;
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
    public.effective_subscription_tier(
      subscription_status,
      trial_expires_at,
      stripe_subscription_id,
      subscription_id
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

  SELECT daily_limit_seconds, monthly_limit_seconds, allowed_engines
  INTO v_daily_limit, v_monthly_limit, v_allowed_engines
  FROM public.tier_configs
  WHERE tier_name = COALESCE(v_effective_tier, 'basic');

  IF v_daily_limit IS NULL THEN
    v_daily_limit := 3600;
    v_monthly_limit := 90000;
    v_allowed_engines := '{"native", "transformers-js", "whisper-turbo"}';
  END IF;

  IF NOT (p_engine_type = ANY(v_allowed_engines)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'engine_not_allowed_for_tier',
      'subscription_status', v_effective_tier
    );
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
    subscription_status = CASE WHEN v_effective_tier = 'basic' THEN 'basic' ELSE subscription_status END,
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
    'monthly_limit', v_monthly_limit,
    'subscription_status', v_effective_tier
  );
END;
$$;

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
    SET LOCAL statement_timeout = '3000ms';

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

    SELECT public.effective_subscription_tier(
        subscription_status,
        trial_expires_at,
        stripe_subscription_id,
        subscription_id
    )
    INTO v_user_tier
    FROM public.user_profiles
    WHERE id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', 'profile_not_found'
        );
    END IF;

    SELECT max_concurrent_sessions INTO v_max_concurrent
    FROM public.tier_configs
    WHERE tier_name = COALESCE(v_user_tier, 'basic');

    IF v_max_concurrent IS NULL THEN
        v_max_concurrent := 1;
    END IF;

    UPDATE public.sessions
    SET
        status = 'failed',
        updated_at = now()
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= now();

    SELECT COUNT(*) INTO v_active_sessions
    FROM public.sessions
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now());

    IF v_active_sessions >= v_max_concurrent THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', 'max_concurrent_sessions_reached',
            'active_sessions', v_active_sessions,
            'max_concurrent_sessions', v_max_concurrent
        );
    END IF;

    v_duration := COALESCE((p_session_data->>'duration')::INT, 0);

    v_usage_check := public.update_user_usage(v_duration, p_engine_type);

    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', v_usage_check->>'error'
        );
    END IF;

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
        now() + interval '1 hour'
    ) RETURNING id INTO v_new_session_id;

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
