-- Harden launch-critical billing/profile invariants identified during release audit.

-- The original policy was FOR ALL, allowing authenticated users to update their
-- own billing/profile entitlement fields directly through the browser client.
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can select own profile" ON public.user_profiles;

CREATE POLICY "Users can select own profile"
ON public.user_profiles
FOR SELECT
USING ((SELECT auth.uid()) = id);

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
  v_reset_changed BOOLEAN := false;
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
    v_reset_changed := true;
  END IF;

  IF v_last_monthly_reset IS NULL OR v_last_monthly_reset <= now() - interval '1 month' THEN
    v_native_usage := 0;
    v_cloud_usage := 0;
    v_last_monthly_reset := now();
    v_reset_changed := true;
  END IF;

  -- Persist reset state before any limit return so users are not trapped behind
  -- stale yesterday/month counters after a rejected session.
  IF v_reset_changed THEN
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

CREATE OR REPLACE FUNCTION public.process_stripe_webhook_event(
    p_event_id text,
    p_event_type text,
    p_action text,
    p_user_id uuid DEFAULT NULL,
    p_subscription_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_success boolean := false;
    v_skipped boolean := false;
    v_error text := NULL;
    v_rows int := 0;
BEGIN
    BEGIN
        INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at)
        VALUES (p_event_id, p_event_type, NOW());
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', true, 'skipped', true);
    END;

    BEGIN
        IF p_action = 'upgrade_to_pro' THEN
            IF p_user_id IS NULL THEN
                RAISE EXCEPTION 'Missing user_id for upgrade';
            END IF;

            UPDATE public.user_profiles
            SET subscription_status = 'pro',
                stripe_subscription_id = p_subscription_id
            WHERE id = p_user_id;

            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows <> 1 THEN
                RAISE EXCEPTION 'Stripe upgrade affected % profiles for user_id %', v_rows, p_user_id;
            END IF;

        ELSIF p_action = 'downgrade_to_basic' THEN
            IF p_subscription_id IS NULL THEN
                RAISE EXCEPTION 'Missing subscription_id for downgrade';
            END IF;

            IF p_event_type = 'customer.subscription.deleted' THEN
                UPDATE public.user_profiles
                SET subscription_status = 'basic',
                    stripe_subscription_id = NULL
                WHERE stripe_subscription_id = p_subscription_id;
            ELSE
                UPDATE public.user_profiles
                SET subscription_status = 'basic'
                WHERE stripe_subscription_id = p_subscription_id;
            END IF;

            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows <> 1 THEN
                RAISE EXCEPTION 'Stripe downgrade affected % profiles for subscription_id %', v_rows, p_subscription_id;
            END IF;

        ELSIF p_action = 'none' THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'Unknown action: %', p_action;
        END IF;

        v_success := true;
    EXCEPTION WHEN OTHERS THEN
        DELETE FROM public.processed_webhook_events WHERE event_id = p_event_id;
        v_success := false;
        v_error := SQLERRM;
    END;

    RETURN jsonb_build_object('success', v_success, 'skipped', v_skipped, 'error', v_error);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_user_usage(INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_usage(INT, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text) TO service_role;
