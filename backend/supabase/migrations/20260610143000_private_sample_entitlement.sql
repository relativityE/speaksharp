-- Replace the former automatic Pro trial with a narrow, server-enforced
-- Private transcription sample.
--
-- Release policy:
-- - Browser/Native remains the free front door.
-- - Unpaid users may intentionally try exactly one short Private session.
-- - The sample is capped by server-side usage/session RPCs, not only UI timers.
-- - Paid Pro users keep normal Private/Cloud entitlement.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS private_sample_limit_seconds INT NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS private_sample_seconds_used INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS private_sample_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS private_sample_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS private_sample_session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL;

ALTER TABLE public.user_profiles
  ALTER COLUMN trial_expires_at DROP DEFAULT;

ALTER TABLE public.trial_entitlements
  ALTER COLUMN trial_expires_at DROP DEFAULT;

UPDATE public.user_profiles
SET
  private_sample_limit_seconds = COALESCE(private_sample_limit_seconds, 300),
  private_sample_seconds_used = LEAST(
    COALESCE(private_sample_limit_seconds, 300),
    GREATEST(0, COALESCE(private_sample_seconds_used, 0))
  ),
  updated_at = now()
WHERE private_sample_limit_seconds IS NULL
   OR private_sample_seconds_used IS NULL
   OR private_sample_seconds_used < 0
   OR private_sample_seconds_used > private_sample_limit_seconds;

UPDATE public.tier_configs
SET allowed_engines = '{"native"}'::TEXT[]
WHERE tier_name IN ('free', 'basic');

UPDATE public.tier_configs
SET allowed_engines = ARRAY(
  SELECT DISTINCT engine
  FROM unnest(allowed_engines || ARRAY['native', 'private', 'cloud']::TEXT[]) AS engine
)
WHERE tier_name = 'pro';

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
    WHEN lower(COALESCE(p_subscription_status, 'free')) = 'pro'
      AND (
        NULLIF(trim(COALESCE(p_stripe_subscription_id, '')), '') IS NOT NULL
        OR NULLIF(trim(COALESCE(p_subscription_id, '')), '') IS NOT NULL
      )
    THEN 'pro'
    ELSE 'free'
  END;
$$;

COMMENT ON FUNCTION public.effective_subscription_tier(TEXT, TIMESTAMPTZ, TEXT, TEXT) IS
  'Returns release entitlement tier. Only Stripe/subscription-backed Pro resolves to pro; legacy trial timestamps do not grant Pro.';

CREATE OR REPLACE FUNCTION public.ensure_trial_profile_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    NULL,
    NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    subscription_status = CASE
      WHEN lower(COALESCE(public.user_profiles.subscription_status, 'free')) = 'pro'
        AND (
          NULLIF(trim(COALESCE(public.user_profiles.stripe_subscription_id, '')), '') IS NOT NULL
          OR NULLIF(trim(COALESCE(public.user_profiles.subscription_id, '')), '') IS NOT NULL
        )
      THEN public.user_profiles.subscription_status
      ELSE 'free'
    END,
    private_sample_limit_seconds = COALESCE(public.user_profiles.private_sample_limit_seconds, EXCLUDED.private_sample_limit_seconds),
    private_sample_seconds_used = COALESCE(public.user_profiles.private_sample_seconds_used, 0),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.update_user_usage(INT, TEXT);
DROP FUNCTION IF EXISTS public.update_user_usage(INT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.update_user_usage(
  p_session_duration_seconds INT,
  p_engine_type TEXT DEFAULT 'native',
  p_session_id UUID DEFAULT NULL
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
  v_reset_changed BOOLEAN := false;
  v_engine TEXT := lower(trim(COALESCE(p_engine_type, '')));
  v_is_private_engine BOOLEAN;
  v_is_cloud_engine BOOLEAN;
  v_sample_limit INT;
  v_sample_used INT;
  v_sample_remaining INT;
  v_sample_session_id UUID;
  v_sample_completed_at TIMESTAMPTZ;
  v_new_sample_used INT;
BEGIN
  IF p_session_duration_seconds IS NULL OR p_session_duration_seconds < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_duration');
  END IF;

  IF v_engine = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_engine');
  END IF;

  v_is_private_engine := v_engine = ANY('{"private","transformers-js","whisper-turbo","transformers-js-v4"}'::TEXT[]);
  v_is_cloud_engine := v_engine = 'cloud';

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
    usage_reset_date,
    COALESCE(private_sample_limit_seconds, 300),
    LEAST(COALESCE(private_sample_limit_seconds, 300), GREATEST(0, COALESCE(private_sample_seconds_used, 0))),
    private_sample_session_id,
    private_sample_completed_at
  INTO
    v_effective_tier,
    v_daily_usage,
    v_native_usage,
    v_cloud_usage,
    v_last_daily_reset,
    v_last_monthly_reset,
    v_sample_limit,
    v_sample_used,
    v_sample_session_id,
    v_sample_completed_at
  FROM public.user_profiles
  WHERE id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  SELECT daily_limit_seconds, monthly_limit_seconds, allowed_engines
  INTO v_daily_limit, v_monthly_limit, v_allowed_engines
  FROM public.tier_configs
  WHERE tier_name = COALESCE(v_effective_tier, 'free');

  IF v_daily_limit IS NULL THEN
    v_daily_limit := 3600;
    v_monthly_limit := 90000;
    v_allowed_engines := '{"native"}';
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

  IF v_daily_usage + p_session_duration_seconds > v_daily_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'daily_limit_reached');
  END IF;

  IF v_native_usage + v_cloud_usage + p_session_duration_seconds > v_monthly_limit THEN
    RETURN jsonb_build_object('success', false, 'error', 'monthly_limit_reached');
  END IF;

  IF v_effective_tier <> 'pro' AND v_is_private_engine THEN
    IF p_session_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'private_sample_session_required',
        'subscription_status', v_effective_tier
      );
    END IF;

    IF v_sample_completed_at IS NOT NULL
      AND (v_sample_session_id IS DISTINCT FROM p_session_id OR v_sample_used >= v_sample_limit)
    THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'private_sample_used',
        'subscription_status', v_effective_tier,
        'private_sample_seconds_remaining', 0
      );
    END IF;

    IF v_sample_session_id IS NOT NULL AND v_sample_session_id IS DISTINCT FROM p_session_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'private_sample_used',
        'subscription_status', v_effective_tier,
        'private_sample_seconds_remaining', 0
      );
    END IF;

    v_sample_remaining := GREATEST(0, v_sample_limit - v_sample_used);

    IF v_sample_remaining <= 0 THEN
      UPDATE public.user_profiles
      SET
        private_sample_completed_at = COALESCE(private_sample_completed_at, now()),
        updated_at = now()
      WHERE id = auth.uid();

      RETURN jsonb_build_object(
        'success', false,
        'error', 'private_sample_limit_reached',
        'subscription_status', v_effective_tier,
        'private_sample_seconds_remaining', 0
      );
    END IF;

    IF p_session_duration_seconds > v_sample_remaining THEN
      UPDATE public.user_profiles
      SET
        private_sample_session_id = COALESCE(private_sample_session_id, p_session_id),
        private_sample_started_at = COALESCE(private_sample_started_at, now()),
        private_sample_seconds_used = v_sample_limit,
        private_sample_completed_at = COALESCE(private_sample_completed_at, now()),
        updated_at = now()
      WHERE id = auth.uid();

      RETURN jsonb_build_object(
        'success', false,
        'error', 'private_sample_limit_reached',
        'subscription_status', v_effective_tier,
        'private_sample_seconds_remaining', 0
      );
    END IF;

    v_new_sample_used := LEAST(v_sample_limit, v_sample_used + p_session_duration_seconds);

    UPDATE public.user_profiles
    SET
      private_sample_session_id = COALESCE(private_sample_session_id, p_session_id),
      private_sample_started_at = COALESCE(private_sample_started_at, now()),
      private_sample_seconds_used = v_new_sample_used,
      private_sample_completed_at = CASE
        WHEN v_new_sample_used >= v_sample_limit THEN COALESCE(private_sample_completed_at, now())
        ELSE private_sample_completed_at
      END,
      updated_at = now()
    WHERE id = auth.uid();
  ELSE
    IF NOT (v_engine = ANY(v_allowed_engines)) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'engine_not_allowed_for_tier',
        'subscription_status', v_effective_tier
      );
    END IF;
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
    'daily_limit', v_daily_limit,
    'monthly_used', v_native_usage + v_cloud_usage,
    'monthly_limit', v_monthly_limit,
    'subscription_status', v_effective_tier,
    'private_sample_seconds_remaining', CASE
      WHEN v_effective_tier <> 'pro' AND v_is_private_engine THEN GREATEST(0, v_sample_limit - v_new_sample_used)
      ELSE NULL
    END
  );
END;
$$;

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
  v_sample_limit INT;
  v_sample_used INT;
  v_sample_started_at TIMESTAMPTZ;
  v_sample_completed_at TIMESTAMPTZ;
  v_sample_session_id UUID;
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
    COALESCE(private_sample_limit_seconds, 300),
    LEAST(COALESCE(private_sample_limit_seconds, 300), GREATEST(0, COALESCE(private_sample_seconds_used, 0))),
    private_sample_started_at,
    private_sample_completed_at,
    private_sample_session_id
  INTO
    v_stored_status,
    v_effective_tier,
    v_daily_usage,
    v_native_usage,
    v_cloud_usage,
    v_last_daily_reset,
    v_last_monthly_reset,
    v_sample_limit,
    v_sample_used,
    v_sample_started_at,
    v_sample_completed_at,
    v_sample_session_id
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    SELECT daily_limit_seconds, monthly_limit_seconds
    INTO v_daily_limit, v_monthly_limit
    FROM public.tier_configs
    WHERE tier_name = 'free';

    RETURN jsonb_build_object(
      'can_start', true,
      'daily_remaining', COALESCE(v_daily_limit, 3600),
      'daily_limit', COALESCE(v_daily_limit, 3600),
      'monthly_remaining', COALESCE(v_monthly_limit, 90000),
      'monthly_limit', COALESCE(v_monthly_limit, 90000),
      'remaining_seconds', COALESCE(v_daily_limit, 3600),
      'limit_seconds', COALESCE(v_daily_limit, 3600),
      'used_seconds', 0,
      'subscription_status', 'free',
      'stored_subscription_status', 'unknown',
      'is_pro', false,
      'trial_active', false,
      'trial_seconds_remaining', 0,
      'private_sample_available', false,
      'private_sample_limit_seconds', 300,
      'private_sample_seconds_used', 0,
      'private_sample_seconds_remaining', 0,
      'error', 'Profile not found'
    );
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
  WHERE tier_name = COALESCE(v_effective_tier, 'free');

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
    'trial_active', false,
    'trial_started_at', NULL,
    'trial_expires_at', NULL,
    'trial_seconds_remaining', 0,
    'private_sample_available', (
      v_effective_tier <> 'pro'
      AND v_sample_completed_at IS NULL
      AND v_sample_used < v_sample_limit
      AND v_sample_session_id IS NULL
    ),
    'private_sample_limit_seconds', v_sample_limit,
    'private_sample_seconds_used', v_sample_used,
    'private_sample_seconds_remaining', GREATEST(0, v_sample_limit - v_sample_used),
    'private_sample_started_at', v_sample_started_at,
    'private_sample_completed_at', v_sample_completed_at,
    'private_sample_session_id', v_sample_session_id
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
    v_new_session_id UUID := gen_random_uuid();
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
    WHERE tier_name = COALESCE(v_user_tier, 'free');

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
    v_usage_check := public.update_user_usage(v_duration, p_engine_type, v_new_session_id);

    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', v_usage_check->>'error'
        );
    END IF;

    INSERT INTO public.sessions (
        id,
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
        v_new_session_id,
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
    );

    IF v_duration > 0 THEN
        INSERT INTO public.usage_checkpoints (session_id, user_id, incremental_seconds, engine_type)
        VALUES (v_new_session_id, auth.uid(), v_duration, p_engine_type);
    END IF;

    RETURN jsonb_build_object(
        'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_new_session_id),
        'usage_exceeded', false,
        'private_sample_seconds_remaining', v_usage_check->'private_sample_seconds_remaining'
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

    v_usage_check := public.update_user_usage(p_incremental_seconds, v_engine_type, p_session_id);

    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', v_usage_check->>'error',
            'subscription_status', v_usage_check->>'subscription_status',
            'private_sample_seconds_remaining', v_usage_check->'private_sample_seconds_remaining'
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
        'subscription_status', v_usage_check->>'subscription_status',
        'private_sample_seconds_remaining', v_usage_check->'private_sample_seconds_remaining'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_session(
    p_session_id UUID,
    p_status TEXT DEFAULT 'completed',
    p_final_transcript TEXT DEFAULT NULL,
    p_final_duration INT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session public.sessions%ROWTYPE;
    v_effective_tier TEXT;
    v_sample_limit INT;
    v_sample_used INT;
    v_final_duration INT;
    v_is_unpaid_sample BOOLEAN := false;
BEGIN
    SELECT * INTO v_session
    FROM public.sessions
    WHERE id = p_session_id AND user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
    END IF;

    SELECT
      public.effective_subscription_tier(
        subscription_status,
        trial_expires_at,
        stripe_subscription_id,
        subscription_id
      ),
      COALESCE(private_sample_limit_seconds, 300),
      COALESCE(private_sample_seconds_used, 0)
    INTO v_effective_tier, v_sample_limit, v_sample_used
    FROM public.user_profiles
    WHERE id = auth.uid()
    FOR UPDATE;

    v_final_duration := GREATEST(0, COALESCE(p_final_duration, v_session.duration, 0));
    v_is_unpaid_sample := (
      v_effective_tier <> 'pro'
      AND lower(COALESCE(v_session.engine, '')) = 'private'
    );

    IF v_is_unpaid_sample THEN
      v_final_duration := LEAST(v_final_duration, v_sample_limit);

      UPDATE public.user_profiles
      SET
        private_sample_session_id = COALESCE(private_sample_session_id, p_session_id),
        private_sample_started_at = COALESCE(private_sample_started_at, v_session.created_at, now()),
        private_sample_seconds_used = LEAST(v_sample_limit, GREATEST(v_sample_used, v_final_duration)),
        private_sample_completed_at = COALESCE(private_sample_completed_at, now()),
        updated_at = now()
      WHERE id = auth.uid();
    END IF;

    UPDATE public.sessions
    SET status = p_status,
        status_reason = COALESCE(p_reason, status_reason),
        transcript = COALESCE(p_final_transcript, transcript),
        duration = CASE
          WHEN v_is_unpaid_sample THEN v_final_duration
          ELSE COALESCE(p_final_duration, duration)
        END,
        updated_at = now()
    WHERE id = p_session_id AND user_id = auth.uid();

    RETURN jsonb_build_object(
        'success', true,
        'final_status', p_status,
        'private_sample_completed', v_is_unpaid_sample
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_usage_limit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_usage_limit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_usage_limit() TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_user_usage(INT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_usage(INT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_usage(INT, TEXT, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_session_and_update_usage(JSONB, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_session_and_update_usage(JSONB, TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_session_and_update_usage(JSONB, TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.heartbeat_session(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.heartbeat_session(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_session(UUID, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) TO service_role;
