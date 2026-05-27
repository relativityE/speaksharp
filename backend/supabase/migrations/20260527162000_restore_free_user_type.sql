-- Restore Free as a first-class user type.
--
-- subscription_status is an entitlement/status label, not revenue truth:
--   free  = unpaid baseline signup
--   basic = future paid Basic plan
--   pro   = paid Pro plan or effective trial entitlement where explicitly returned
--
-- Revenue and paid-plan counts must be derived from Stripe subscription evidence,
-- never from subscription_status alone.

ALTER TABLE public.user_profiles
ALTER COLUMN subscription_status SET DEFAULT 'free';

COMMENT ON COLUMN public.user_profiles.subscription_status IS
  'User type / entitlement status: free, basic, or pro. Do not use this column alone as revenue truth.';

INSERT INTO public.tier_configs (
  tier_name,
  daily_limit_seconds,
  monthly_limit_seconds,
  max_concurrent_sessions,
  allowed_engines
)
SELECT
  'free',
  daily_limit_seconds,
  monthly_limit_seconds,
  max_concurrent_sessions,
  allowed_engines
FROM public.tier_configs
WHERE tier_name = 'basic'
ON CONFLICT (tier_name) DO UPDATE
SET
  daily_limit_seconds = EXCLUDED.daily_limit_seconds,
  monthly_limit_seconds = EXCLUDED.monthly_limit_seconds,
  max_concurrent_sessions = EXCLUDED.max_concurrent_sessions,
  allowed_engines = EXCLUDED.allowed_engines;

-- This product has not launched paid Basic. Existing unpaid baseline users
-- created during the Basic cutover should be represented as Free unless they
-- have payment evidence attached.
UPDATE public.user_profiles
SET subscription_status = 'free',
    updated_at = now()
WHERE lower(COALESCE(subscription_status, '')) = 'basic'
  AND NULLIF(stripe_subscription_id, '') IS NULL
  AND NULLIF(subscription_id, '') IS NULL;

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
    WHEN p_trial_expires_at IS NOT NULL
      AND p_trial_expires_at > now()
    THEN 'pro'
    WHEN lower(COALESCE(p_subscription_status, 'free')) = 'pro'
    THEN 'pro'
    WHEN lower(COALESCE(p_subscription_status, 'free')) = 'basic'
    THEN 'basic'
    ELSE 'free'
  END;
$$;

COMMENT ON FUNCTION public.effective_subscription_tier(TEXT, TIMESTAMPTZ, TEXT, TEXT) IS
  'Returns effective entitlement tier. Free and future paid Basic are distinct statuses; paid evidence must be checked separately for revenue.';

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
    'free',
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
        IF p_action = 'activate_basic' THEN
            IF p_user_id IS NULL THEN
                RAISE EXCEPTION 'Missing user_id for paid Basic activation';
            END IF;

            UPDATE public.user_profiles
            SET subscription_status = 'basic',
                stripe_subscription_id = p_subscription_id,
                updated_at = now()
            WHERE id = p_user_id;

            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows <> 1 THEN
                RAISE EXCEPTION 'Stripe Basic activation affected % profiles for user_id %', v_rows, p_user_id;
            END IF;

        ELSIF p_action = 'upgrade_to_pro' THEN
            IF p_user_id IS NULL THEN
                RAISE EXCEPTION 'Missing user_id for Pro upgrade';
            END IF;

            UPDATE public.user_profiles
            SET subscription_status = 'pro',
                stripe_subscription_id = p_subscription_id,
                updated_at = now()
            WHERE id = p_user_id;

            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows <> 1 THEN
                RAISE EXCEPTION 'Stripe Pro upgrade affected % profiles for user_id %', v_rows, p_user_id;
            END IF;

        ELSIF p_action = 'downgrade_to_basic' THEN
            IF p_subscription_id IS NULL THEN
                RAISE EXCEPTION 'Missing subscription_id for downgrade';
            END IF;

            IF p_event_type = 'customer.subscription.deleted' THEN
                UPDATE public.user_profiles
                SET subscription_status = 'free',
                    stripe_subscription_id = NULL,
                    updated_at = now()
                WHERE stripe_subscription_id = p_subscription_id;
            ELSE
                UPDATE public.user_profiles
                SET subscription_status = 'free',
                    updated_at = now()
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

REVOKE EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text) TO service_role;
