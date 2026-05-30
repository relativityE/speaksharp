-- Accept the current Free-baseline downgrade action while preserving the
-- legacy `downgrade_to_basic` alias for already-deployed callers and retries.

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
    v_warning text := NULL;
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

        ELSIF p_action IN ('downgrade_to_free', 'downgrade_to_basic') THEN
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

REVOKE EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text) TO service_role;
