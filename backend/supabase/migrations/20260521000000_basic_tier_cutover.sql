-- Cut over the internal unpaid tier to "basic".
-- This project has not launched publicly, so the change is strict: runtime
-- entitlement responses and newly persisted unpaid profiles use only "basic".

ALTER TABLE public.user_profiles
ALTER COLUMN subscription_status SET DEFAULT 'basic';

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

COMMENT ON COLUMN public.user_profiles.stripe_subscription_id IS
  'Stripe subscription id for paid Pro users.';

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

INSERT INTO public.tier_configs (
  tier_name,
  daily_limit_seconds,
  monthly_limit_seconds,
  max_concurrent_sessions,
  allowed_engines
)
VALUES ('basic', 3600, 90000, 1, '{"native", "transformers-js", "whisper-turbo"}')
ON CONFLICT (tier_name) DO NOTHING;

UPDATE public.user_profiles
SET subscription_status = 'basic'
WHERE lower(COALESCE(subscription_status, '')) = 'free';

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
    WHEN lower(COALESCE(p_subscription_status, 'basic')) = 'pro'
      AND (
        NULLIF(p_stripe_subscription_id, '') IS NOT NULL
        OR NULLIF(p_subscription_id, '') IS NOT NULL
      )
    THEN 'pro'
    ELSE 'basic'
  END;
$$;

COMMENT ON FUNCTION public.effective_subscription_tier(TEXT, TIMESTAMPTZ, TEXT, TEXT) IS
  'Returns the tier used for DB-side entitlement checks before automatic trials are installed.';

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
BEGIN
  SELECT
    subscription_status,
    public.effective_subscription_tier(
      subscription_status,
      NULL::timestamptz,
      stripe_subscription_id,
      subscription_id
    ),
    COALESCE(daily_usage_seconds, 0),
    COALESCE(native_usage_seconds, 0),
    COALESCE(cloud_usage_seconds, 0),
    last_daily_reset,
    usage_reset_date
  INTO
    v_stored_status,
    v_effective_tier,
    v_daily_usage,
    v_native_usage,
    v_cloud_usage,
    v_last_daily_reset,
    v_last_monthly_reset
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
      'subscription_status', 'basic',
      'stored_subscription_status', 'unknown',
      'is_pro', false,
      'error', 'Profile not found'
    );
  END IF;

  IF lower(COALESCE(v_stored_status, '')) = 'free' THEN
    UPDATE public.user_profiles
    SET subscription_status = 'basic', updated_at = now()
    WHERE id = auth.uid();
    v_stored_status := 'basic';
    v_effective_tier := 'basic';
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
    'subscription_status', v_effective_tier,
    'stored_subscription_status', v_stored_status,
    'is_pro', (v_effective_tier = 'pro')
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
      NULL::timestamptz,
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
    subscription_status = v_effective_tier,
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

CREATE OR REPLACE FUNCTION public.update_user_usage(session_duration_seconds INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage_check JSONB;
BEGIN
  v_usage_check := public.update_user_usage(session_duration_seconds, 'native');
  RETURN COALESCE((v_usage_check->>'success')::BOOLEAN, false);
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
        NULL::timestamptz,
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

    v_usage_check := public.update_user_usage(p_incremental_seconds, v_engine_type);

    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', v_usage_check->>'error',
            'subscription_status', v_usage_check->>'subscription_status'
        );
    END IF;

    UPDATE public.sessions
    SET
        duration = duration + p_incremental_seconds,
        expires_at = now() + interval '5 minutes',
        updated_at = now()
    WHERE id = p_session_id AND user_id = auth.uid();

    INSERT INTO public.usage_checkpoints (session_id, user_id, incremental_seconds, engine_type)
    VALUES (p_session_id, auth.uid(), p_incremental_seconds, v_engine_type);

    RETURN jsonb_build_object(
        'success', true,
        'subscription_status', v_usage_check->>'subscription_status'
    );
END;
$$;

CREATE OR REPLACE FUNCTION process_stripe_webhook_event(
    p_event_id text,
    p_event_type text,
    p_action text,
    p_user_id uuid DEFAULT NULL,
    p_subscription_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_success boolean := false;
    v_skipped boolean := false;
    v_error text := NULL;
BEGIN
    BEGIN
        INSERT INTO processed_webhook_events (event_id, event_type, processed_at)
        VALUES (p_event_id, p_event_type, NOW());
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', true, 'skipped', true);
    END;

    BEGIN
        IF p_action = 'upgrade_to_pro' THEN
            IF p_user_id IS NULL THEN
                RAISE EXCEPTION 'Missing user_id for upgrade';
            END IF;

            UPDATE user_profiles
            SET subscription_status = 'pro',
                stripe_subscription_id = p_subscription_id
            WHERE id = p_user_id;

        ELSIF p_action = 'downgrade_to_basic' THEN
            IF p_subscription_id IS NULL THEN
                RAISE EXCEPTION 'Missing subscription_id for downgrade';
            END IF;

            IF p_event_type = 'customer.subscription.deleted' THEN
                UPDATE user_profiles
                SET subscription_status = 'basic',
                    stripe_subscription_id = NULL
                WHERE stripe_subscription_id = p_subscription_id;
            ELSE
                UPDATE user_profiles
                SET subscription_status = 'basic'
                WHERE stripe_subscription_id = p_subscription_id;
            END IF;

        ELSIF p_action = 'none' THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'Unknown action: %', p_action;
        END IF;

        v_success := true;
    EXCEPTION WHEN OTHERS THEN
        DELETE FROM processed_webhook_events WHERE event_id = p_event_id;
        v_success := false;
        v_error := SQLERRM;
    END;

    RETURN jsonb_build_object('success', v_success, 'skipped', v_skipped, 'error', v_error);
END;
$$;

REVOKE EXECUTE ON FUNCTION process_stripe_webhook_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_stripe_webhook_event TO service_role;

DELETE FROM public.tier_configs
WHERE tier_name = 'free';
