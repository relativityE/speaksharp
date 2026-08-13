-- #1282 / #1266 — canonical Stripe snapshots must converge even when Stripe retries the same event id.
--
-- 20260812002000 is already applied and is immutable. Its receipt insert returned early on a duplicate
-- event id, which could suppress a newly hydrated absolute subscription snapshot. This additive migration
-- keeps processed_webhook_events as audit/receipt identity while applying every validated nonterminal
-- snapshot. A failure removes only a receipt inserted by the failing invocation; a pre-existing receipt is
-- never deleted. Terminal tombstones remain sticky and customer/subscription identity stays fail closed.

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

    -- Receipt identity is audit state, not a convergence gate. ON CONFLICT records whether this invocation
    -- inserted the receipt, then every invocation applies the newly hydrated absolute snapshot below.
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
