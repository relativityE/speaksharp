-- Burn the one-time free Private STT 5-minute sample on any paid->free downgrade.
--
-- Requirement (release-owner, 2026-06-19): a refunded / canceled / past-due user who is
-- downgraded to Free must NOT regain the one-time 5-minute Private sampler.
--
-- Prior behavior: downgrade set subscription_status='free' (and cleared stripe_subscription_id
-- on customer.subscription.deleted) but left the private_sample_* columns untouched. Since
-- check_usage_limit treats the sample as available while (private_sample_completed_at IS NULL
-- AND private_sample_seconds_used < private_sample_limit_seconds), an ex-paid user who never
-- consumed the sample (seconds_used=0) would regain it after downgrade.
--
-- This re-creates the 6-arg process_stripe_webhook_event so the downgrade branch ALSO marks the
-- sample fully consumed/closed. activate_basic / upgrade_to_pro / none branches are unchanged.
-- NOTE (open question for review): non-deleted downgrades (customer.subscription.updated with
-- canceled/unpaid/past_due) still retain stripe_subscription_id here, matching prior behavior —
-- so hasPaidProEntitlement (which keys off stripe_subscription_id/subscription_id) could keep
-- Cloud available for a "free" row until a delete event clears it. If downgrades should fully
-- revoke paid features in BOTH branches, also null stripe_subscription_id in the ELSE branch.

CREATE OR REPLACE FUNCTION public.process_stripe_webhook_event(
    p_event_id text,
    p_event_type text,
    p_action text,
    p_user_id uuid DEFAULT NULL,
    p_subscription_id text DEFAULT NULL,
    p_stripe_customer_id text DEFAULT NULL
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
    v_warning text := NULL;
    v_rows int := 0;
    v_customer_id text := NULLIF(BTRIM(COALESCE(p_stripe_customer_id, '')), '');
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
                stripe_customer_id = COALESCE(v_customer_id, stripe_customer_id),
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
                stripe_customer_id = COALESCE(v_customer_id, stripe_customer_id),
                updated_at = now()
            WHERE id = p_user_id;

            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows <> 1 THEN
                RAISE EXCEPTION 'Stripe Pro upgrade affected % profiles for user_id %', v_rows, p_user_id;
            END IF;

        ELSIF p_action IN ('downgrade_to_free', 'downgrade_to_basic') THEN
            IF p_subscription_id IS NULL THEN
                RAISE EXCEPTION 'Missing subscription_id for downgrade';
            END IF;

            -- Burn the one-time free Private sample on paid->free downgrade so a refunded/
            -- canceled/past-due user cannot regain the 5-minute Private sampler.
            IF p_event_type = 'customer.subscription.deleted' THEN
                UPDATE public.user_profiles
                SET subscription_status = 'free',
                    stripe_subscription_id = NULL,
                    private_sample_seconds_used = COALESCE(private_sample_limit_seconds, 300),
                    private_sample_completed_at = COALESCE(private_sample_completed_at, now()),
                    updated_at = now()
                WHERE stripe_subscription_id = p_subscription_id;
            ELSE
                UPDATE public.user_profiles
                SET subscription_status = 'free',
                    private_sample_seconds_used = COALESCE(private_sample_limit_seconds, 300),
                    private_sample_completed_at = COALESCE(private_sample_completed_at, now()),
                    updated_at = now()
                WHERE stripe_subscription_id = p_subscription_id;
            END IF;

            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows > 1 THEN
                RAISE EXCEPTION 'Stripe downgrade affected % profiles for subscription_id %', v_rows, p_subscription_id;
            ELSIF v_rows = 0 THEN
                v_warning := format('Stripe downgrade matched no profiles for subscription_id %s', p_subscription_id);
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

    RETURN jsonb_build_object(
        'success', v_success,
        'skipped', v_skipped,
        'error', v_error,
        'warning', v_warning
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text, text) TO service_role;
