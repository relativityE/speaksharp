-- #1290 — converge the flawless-launch runtime and retain Stripe cancellation audit state.
--
-- The applied #1287 function signature accepts cancel_at_period_end and current_period_end, but its
-- body discarded both values. Besides producing database-lint warnings, that made an accurately hydrated
-- Stripe snapshot indistinguishable from one whose period metadata was never supplied. This additive
-- migration preserves the accepted signature and entitlement/identity/tombstone behavior while making the
-- two inputs meaningful, validated audit fields. They never grant or extend access: current Stripe status
-- plus approved-price validation remains the sole paid-entitlement authority.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS stripe_cancel_at_period_end boolean,
  ADD COLUMN IF NOT EXISTS stripe_current_period_end timestamptz;

COMMENT ON COLUMN public.user_profiles.stripe_cancel_at_period_end IS
  '#1290 AUDIT ONLY: latest hydrated Stripe cancel_at_period_end value. Never grants or extends access.';

COMMENT ON COLUMN public.user_profiles.stripe_current_period_end IS
  '#1290 AUDIT ONLY: latest hydrated Stripe current_period_end. Never grants or extends access.';

CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_snapshot(
    p_event_id text,
    p_subscription_id text,
    p_customer_id text,
    p_status text,
    p_has_approved_price boolean,
    p_cancel_at_period_end boolean DEFAULT false,
    p_current_period_end bigint DEFAULT NULL,
    p_user_id uuid DEFAULT NULL,
    p_event_created bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_subscription text := NULLIF(BTRIM(COALESCE(p_subscription_id, '')), '');
    v_customer text := NULLIF(BTRIM(COALESCE(p_customer_id, '')), '');
    v_status text := lower(BTRIM(COALESCE(p_status, '')));
    v_event_at timestamptz := CASE WHEN p_event_created IS NULL THEN NULL ELSE to_timestamp(p_event_created) END;
    v_period_end_at timestamptz := CASE WHEN p_current_period_end IS NULL THEN NULL ELSE to_timestamp(p_current_period_end) END;
    v_pro boolean;
    v_terminal boolean;
    v_rows int := 0;
    v_receipt_inserted boolean := false;
    v_error text := NULL;
    v_bound_user uuid := NULL;
    v_bound_customer text := NULL;
    v_existing_subscription text := NULL;
    v_existing_customer text := NULL;
    v_tombstone_customer text := NULL;
BEGIN
    IF NULLIF(BTRIM(COALESCE(p_event_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: event_id is required';
    END IF;
    IF v_subscription IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: subscription_id is required';
    END IF;
    IF v_customer IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: customer_id is required';
    END IF;
    IF v_status NOT IN ('active', 'trialing', 'past_due', 'unpaid', 'incomplete',
                        'incomplete_expired', 'paused', 'canceled') THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: unsupported status %', v_status;
    END IF;
    IF p_has_approved_price IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: approved-price result is required';
    END IF;
    IF p_cancel_at_period_end IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: cancel_at_period_end is required';
    END IF;
    IF p_current_period_end IS NOT NULL AND p_current_period_end <= 0 THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: current_period_end must be a positive Unix timestamp';
    END IF;
    IF p_cancel_at_period_end AND p_current_period_end IS NULL THEN
        RAISE EXCEPTION 'apply_stripe_subscription_snapshot: scheduled cancellation requires current_period_end';
    END IF;

    -- Receipt identity is audit state, not a convergence gate. Every validated delivery applies the newly
    -- hydrated absolute snapshot, including a duplicate Stripe event id.
    INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at)
    VALUES (p_event_id, 'subscription.snapshot', NOW())
    ON CONFLICT (event_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_receipt_inserted := v_rows = 1;
    v_rows := 0;

    BEGIN
        v_pro := v_status IN ('active', 'trialing') AND p_has_approved_price;
        v_terminal := v_status IN ('canceled', 'incomplete_expired');

        IF p_user_id IS NOT NULL THEN
            SELECT stripe_subscription_id, stripe_customer_id
              INTO v_existing_subscription, v_existing_customer
              FROM public.user_profiles
             WHERE id = p_user_id
             FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'snapshot: user_id % does not identify a profile', p_user_id;
            END IF;
            IF EXISTS (SELECT 1 FROM public.stripe_subscription_tombstones
                       WHERE subscription_id = v_subscription) THEN
                RAISE EXCEPTION 'snapshot: subscription_id % is terminal and cannot be rebound', v_subscription;
            END IF;
            IF EXISTS (SELECT 1 FROM public.user_profiles
                       WHERE stripe_subscription_id = v_subscription AND id <> p_user_id) THEN
                RAISE EXCEPTION 'snapshot: subscription_id % already bound to a different profile', v_subscription;
            END IF;
            IF EXISTS (SELECT 1 FROM public.user_profiles
                       WHERE stripe_customer_id = v_customer AND id <> p_user_id) THEN
                RAISE EXCEPTION 'snapshot: customer_id % already bound to a different profile', v_customer;
            END IF;
            IF v_existing_subscription IS NOT NULL
               AND v_existing_subscription <> v_subscription THEN
                RAISE EXCEPTION 'snapshot: profile % already holds a different subscription id (conflicting billing identity)', p_user_id;
            END IF;
            IF v_existing_customer IS NOT NULL AND v_existing_customer <> v_customer THEN
                RAISE EXCEPTION 'snapshot: profile % already holds a different customer id (conflicting billing identity)', p_user_id;
            END IF;
            IF v_terminal
               AND (v_existing_subscription IS NULL OR v_existing_customer IS NULL) THEN
                RAISE EXCEPTION 'snapshot: terminal state requires an exact existing subscription/customer binding';
            END IF;
            IF NOT p_has_approved_price
               AND (v_existing_subscription IS NULL OR v_existing_customer IS NULL) THEN
                RAISE EXCEPTION 'snapshot: first binding requires the approved price';
            END IF;

            IF v_terminal THEN
                INSERT INTO public.stripe_subscription_tombstones
                    (subscription_id, customer_id, terminal_status, event_id)
                VALUES (v_subscription, v_customer, v_status, p_event_id);
            END IF;

            UPDATE public.user_profiles
            SET subscription_status = CASE WHEN v_pro THEN 'pro' ELSE 'free' END,
                stripe_subscription_id = CASE WHEN v_terminal THEN NULL ELSE v_subscription END,
                subscription_id = CASE WHEN v_terminal THEN NULL ELSE subscription_id END,
                stripe_customer_id = CASE WHEN v_existing_customer IS NULL THEN v_customer ELSE stripe_customer_id END,
                stripe_cancel_at_period_end = p_cancel_at_period_end,
                stripe_current_period_end = v_period_end_at,
                last_stripe_event_at = GREATEST(
                    COALESCE(last_stripe_event_at, to_timestamp(0)),
                    COALESCE(v_event_at, to_timestamp(0))
                ),
                updated_at = now()
            WHERE id = p_user_id;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows <> 1 THEN
                RAISE EXCEPTION 'snapshot affected % profiles for user_id %', v_rows, p_user_id;
            END IF;

        ELSE
            BEGIN
                SELECT id, stripe_customer_id
                  INTO STRICT v_bound_user, v_bound_customer
                  FROM public.user_profiles
                 WHERE stripe_subscription_id = v_subscription
                 FOR UPDATE;

                IF v_bound_customer IS NULL OR v_bound_customer <> v_customer THEN
                    RAISE EXCEPTION 'snapshot: customer_id does not match the profile bound to subscription_id %', v_subscription;
                END IF;
                IF EXISTS (SELECT 1 FROM public.user_profiles
                           WHERE stripe_customer_id = v_customer AND id <> v_bound_user) THEN
                    RAISE EXCEPTION 'snapshot: customer_id % is bound to multiple profiles', v_customer;
                END IF;

                IF v_terminal THEN
                    INSERT INTO public.stripe_subscription_tombstones
                        (subscription_id, customer_id, terminal_status, event_id)
                    VALUES (v_subscription, v_customer, v_status, p_event_id);
                END IF;

                UPDATE public.user_profiles
                SET subscription_status = CASE WHEN v_pro THEN 'pro' ELSE 'free' END,
                    stripe_subscription_id = CASE WHEN v_terminal THEN NULL ELSE stripe_subscription_id END,
                    subscription_id = CASE WHEN v_terminal THEN NULL ELSE subscription_id END,
                    stripe_cancel_at_period_end = p_cancel_at_period_end,
                    stripe_current_period_end = v_period_end_at,
                    last_stripe_event_at = GREATEST(
                        COALESCE(last_stripe_event_at, to_timestamp(0)),
                        COALESCE(v_event_at, to_timestamp(0))
                    ),
                    updated_at = now()
                WHERE id = v_bound_user;
                GET DIAGNOSTICS v_rows = ROW_COUNT;
                IF v_rows <> 1 THEN
                    RAISE EXCEPTION 'snapshot affected % profiles for subscription_id %', v_rows, v_subscription;
                END IF;
            EXCEPTION WHEN no_data_found THEN
                SELECT customer_id INTO v_tombstone_customer
                  FROM public.stripe_subscription_tombstones
                 WHERE subscription_id = v_subscription;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'snapshot: subscription_id % is not bound and is not terminal (status=%)', v_subscription, v_status;
                END IF;
                IF v_tombstone_customer <> v_customer THEN
                    RAISE EXCEPTION 'snapshot: customer_id does not match terminal subscription_id %', v_subscription;
                END IF;
                v_rows := 0;
                v_pro := false;
            END;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'rows', v_rows,
            'entitlement', CASE WHEN v_pro THEN 'pro' ELSE 'free' END,
            'terminal', v_terminal,
            'approved_price', p_has_approved_price,
            'cancel_at_period_end', p_cancel_at_period_end,
            'current_period_end', p_current_period_end,
            'receipt_preexisting', NOT v_receipt_inserted,
            'non_grant_reason', CASE
                WHEN v_status IN ('active', 'trialing') AND NOT p_has_approved_price THEN 'unapproved_price'
                WHEN NOT v_pro THEN 'non_granting_status'
                ELSE NULL
            END
        );
    EXCEPTION WHEN OTHERS THEN
        -- A failed invocation may remove only the receipt it inserted. A pre-existing receipt is durable
        -- audit history and cannot be erased by a later mismatched/invalid retry.
        IF v_receipt_inserted THEN
            DELETE FROM public.processed_webhook_events WHERE event_id = p_event_id;
        END IF;
        v_error := SQLERRM;
        RETURN jsonb_build_object('success', false, 'error', v_error);
    END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_stripe_subscription_snapshot(text, text, text, text, boolean, boolean, bigint, uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stripe_subscription_snapshot(text, text, text, text, boolean, boolean, bigint, uuid, bigint)
  TO service_role;

-- Usage counters remain content-free telemetry. They never deny, shorten, or upsell an active trial or
-- paid account, and no retired sample/quota fields are returned to callers.
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
BEGIN
  IF p_session_duration_seconds IS NULL OR p_session_duration_seconds < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_duration');
  END IF;
  IF v_engine = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_engine');
  END IF;
  IF p_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sessions
    WHERE id = p_session_id
      AND user_id = auth.uid()
      AND lower(COALESCE(engine, '')) = v_engine
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

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
  IF COALESCE(v_effective_tier, 'free') <> 'pro' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'trial_expired',
      'subscription_status', v_effective_tier
    );
  END IF;

  SELECT allowed_engines INTO v_allowed_engines
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
    SET daily_usage_seconds = v_daily_usage,
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
  IF v_engine = 'cloud' THEN
    v_cloud_usage := v_cloud_usage + p_session_duration_seconds;
  ELSE
    v_native_usage := v_native_usage + p_session_duration_seconds;
  END IF;

  UPDATE public.user_profiles
  SET daily_usage_seconds = v_daily_usage,
      native_usage_seconds = v_native_usage,
      cloud_usage_seconds = v_cloud_usage,
      last_daily_reset = v_last_daily_reset,
      usage_reset_date = v_last_monthly_reset,
      usage_seconds = v_native_usage + v_cloud_usage,
      updated_at = now()
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'subscription_status', v_effective_tier
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_usage_limit()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stored_status TEXT;
  v_effective_tier TEXT;
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
    trial_expires_at,
    (lower(COALESCE(subscription_status, 'free')) = 'pro'
      AND NULLIF(trim(COALESCE(stripe_subscription_id, '')), '') IS NOT NULL)
  INTO v_stored_status, v_effective_tier, v_trial_expires_at, v_is_paid
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'can_start', false,
      'subscription_status', 'free',
      'stored_subscription_status', 'unknown',
      'is_pro', false,
      'trial_active', false,
      'trial_expires_at', NULL,
      'trial_seconds_remaining', 0,
      'error', 'profile_not_found'
    );
  END IF;

  v_trial_active := (v_effective_tier = 'pro' AND NOT v_is_paid
    AND v_trial_expires_at IS NOT NULL AND v_trial_expires_at > now());

  IF COALESCE(v_effective_tier, 'free') <> 'pro' THEN
    RETURN jsonb_build_object(
      'can_start', false,
      'subscription_status', v_effective_tier,
      'stored_subscription_status', v_stored_status,
      'is_pro', false,
      'trial_active', false,
      'trial_expires_at', v_trial_expires_at,
      'trial_seconds_remaining', 0,
      'error', 'trial_expired'
    );
  END IF;

  RETURN jsonb_build_object(
    'can_start', true,
    'subscription_status', v_effective_tier,
    'stored_subscription_status', v_stored_status,
    'is_pro', true,
    'trial_active', v_trial_active,
    'trial_expires_at', v_trial_expires_at,
    'trial_seconds_remaining', CASE
      WHEN v_trial_active THEN GREATEST(0, EXTRACT(EPOCH FROM (v_trial_expires_at - now()))::INT)
      ELSE 0
    END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_user_usage(INT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_user_usage(INT, TEXT, UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.check_usage_limit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_usage_limit() TO authenticated, service_role;

-- Persist through the accepted entitlement seam and return only lifecycle state. Historical sample/quota
-- response keys are removed; concurrency and retention behavior are unchanged.
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_session_id UUID;
    v_new_session_id UUID := gen_random_uuid();
    v_duration INT;
    v_usage_check JSONB;
    v_user_tier TEXT;
    v_max_concurrent INT;
    v_active_sessions INT;
    v_retention JSONB;
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
        subscription_id,
        commercial_trial_granted_at
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
    SET status = 'failed', updated_at = now()
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

    INSERT INTO public.sessions (
        id, user_id, title, duration, total_words, filler_words, accuracy, ground_truth,
        transcript, engine, clarity_score, wpm, idempotency_key, engine_version,
        model_name, device_type, status, expires_at
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

    v_usage_check := public.update_user_usage(v_duration, p_engine_type, v_new_session_id);
    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        DELETE FROM public.sessions
        WHERE id = v_new_session_id AND user_id = auth.uid();
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', v_usage_check->>'error'
        );
    END IF;

    IF v_duration > 0 THEN
        INSERT INTO public.usage_checkpoints (session_id, user_id, incremental_seconds, engine_type)
        VALUES (v_new_session_id, auth.uid(), v_duration, p_engine_type);
    END IF;

    BEGIN
        v_retention := public.converge_transcript_retention(auth.uid());
    EXCEPTION
        WHEN query_canceled THEN
            v_retention := jsonb_build_object('status', 'error');
        WHEN OTHERS THEN
            v_retention := jsonb_build_object('status', 'error');
    END;

    RETURN jsonb_build_object(
        'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_new_session_id),
        'usage_exceeded', false,
        'retention', v_retention
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_session(
    p_session_id UUID,
    p_incremental_seconds INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
            'subscription_status', v_usage_check->>'subscription_status'
        );
    END IF;

    UPDATE public.sessions
    SET duration = duration + p_incremental_seconds,
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
        'retention', v_retention
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_session_and_update_usage(JSONB, TEXT, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_session_and_update_usage(JSONB, TEXT, UUID, TEXT, TEXT, TEXT)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.heartbeat_session(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_session(UUID, INT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) TO authenticated, service_role;
