-- #1282 / #1266 — 30-day trial lifecycle, slice 4: webhook lifecycle completeness.
--
-- Extends process_stripe_webhook_event for the full paid lifecycle required by #1266:
--   * RENEWAL: invoice.payment_succeeded re-affirms 'pro' for the subscription (clears a prior
--     past-due lapse without needing userId metadata — keyed on stripe_subscription_id).
--   * CANCEL-THROUGH-PERIOD-END: an active subscription flagged cancel_at_period_end keeps access
--     (the edge handler emits 'none'); the eventual customer.subscription.deleted at period end runs
--     the existing downgrade. This migration only needs to NOT regress the active state meanwhile,
--     which the out-of-order guard below guarantees.
--   * PAYMENT FAILURE -> RECOVERABLE LAPSE: repeated invoice.payment_failed (and past_due/unpaid) suspend
--     access via the new `lapse_pro` action, which sets status 'free' but PRESERVES stripe_subscription_id
--     so a later successful recovery (invoice.payment_succeeded -> renew_pro, keyed on the sub id) can
--     restore Pro. Only terminal cancellation (subscription.deleted / canceled) CLEARS the id.
--   * DUPLICATE / REPLAY: unchanged (processed_webhook_events event_id idempotency).
--   * OUT-OF-ORDER: NEW. Stripe delivery is not ordered; a stale customer.subscription.updated
--     (active) can arrive AFTER a customer.subscription.deleted and would wrongly re-upgrade a
--     canceled user. We record the newest applied billing-event time per profile and IGNORE any
--     state-changing event older than it. Ordering authority is the Stripe event 'created' time,
--     passed as p_event_created (unix seconds).
--
-- Applying this migration activates no billing and charges nothing.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS last_stripe_event_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_profiles.last_stripe_event_at IS
  '#1282 out-of-order guard: Stripe created-time of the newest APPLIED billing webhook for this '
  'profile. State-changing webhook actions ignore any event older than this.';

-- NOTE (deployment-order safety): the 7-arg form takes NO argument defaults. Both callers always pass all
-- seven (the new Edge explicitly; the 6-arg shim below passes NULL::bigint). Giving p_event_created a
-- DEFAULT would make a 6-arg call ambiguous between this function and the 6-arg shim ("function ... is not
-- unique"), breaking the pre-#1282 Edge. With no defaults here, a 6-arg call resolves ONLY to the shim and a
-- 7-arg call resolves ONLY to this function.
CREATE OR REPLACE FUNCTION public.process_stripe_webhook_event(
    p_event_id text,
    p_event_type text,
    p_action text,
    p_user_id uuid,
    p_subscription_id text,
    p_stripe_customer_id text,
    p_event_created bigint
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
    v_event_at timestamptz := CASE WHEN p_event_created IS NULL THEN NULL ELSE to_timestamp(p_event_created) END;
    v_last_at timestamptz;
    v_found boolean;
BEGIN
    -- Duplicate / replay guard (unchanged): the same event id is processed at most once.
    BEGIN
        INSERT INTO public.processed_webhook_events (event_id, event_type, processed_at)
        VALUES (p_event_id, p_event_type, NOW());
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', true, 'skipped', true);
    END;

    BEGIN
        IF p_action IN ('activate_basic', 'upgrade_to_pro') THEN
            IF p_user_id IS NULL THEN
                RAISE EXCEPTION 'Missing user_id for %', p_action;
            END IF;

            -- Out-of-order guard (user-keyed). Ignore an event older than the last applied one.
            SELECT last_stripe_event_at INTO v_last_at FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Stripe % affected 0 profiles for user_id %', p_action, p_user_id;
            END IF;
            IF v_event_at IS NOT NULL AND v_last_at IS NOT NULL AND v_last_at >= v_event_at THEN
                v_success := true;
                v_warning := 'ignored_out_of_order';
            ELSE
                UPDATE public.user_profiles
                SET subscription_status = CASE WHEN p_action = 'upgrade_to_pro' THEN 'pro' ELSE 'basic' END,
                    stripe_subscription_id = p_subscription_id,
                    stripe_customer_id = COALESCE(v_customer_id, stripe_customer_id),
                    last_stripe_event_at = GREATEST(COALESCE(last_stripe_event_at, to_timestamp(0)), COALESCE(v_event_at, to_timestamp(0))),
                    updated_at = now()
                WHERE id = p_user_id;

                GET DIAGNOSTICS v_rows = ROW_COUNT;
                IF v_rows <> 1 THEN
                    RAISE EXCEPTION 'Stripe % affected % profiles for user_id %', p_action, v_rows, p_user_id;
                END IF;
            END IF;

        ELSIF p_action = 'renew_pro' THEN
            -- Renewal (invoice.payment_succeeded). Re-affirm 'pro' for the subscription and clear any
            -- prior past-due lapse. Subscription-keyed (renewal invoices need no userId metadata).
            IF p_subscription_id IS NULL THEN
                RAISE EXCEPTION 'Missing subscription_id for renewal';
            END IF;

            SELECT last_stripe_event_at INTO v_last_at
            FROM public.user_profiles WHERE stripe_subscription_id = p_subscription_id FOR UPDATE;
            v_found := FOUND;

            IF v_found AND v_event_at IS NOT NULL AND v_last_at IS NOT NULL AND v_last_at >= v_event_at THEN
                v_success := true;
                v_warning := 'ignored_out_of_order';
            ELSE
                UPDATE public.user_profiles
                SET subscription_status = 'pro',
                    stripe_customer_id = COALESCE(v_customer_id, stripe_customer_id),
                    last_stripe_event_at = GREATEST(COALESCE(last_stripe_event_at, to_timestamp(0)), COALESCE(v_event_at, to_timestamp(0))),
                    updated_at = now()
                WHERE stripe_subscription_id = p_subscription_id;

                GET DIAGNOSTICS v_rows = ROW_COUNT;
                IF v_rows > 1 THEN
                    RAISE EXCEPTION 'Stripe renewal affected % profiles for subscription_id %', v_rows, p_subscription_id;
                ELSIF v_rows = 0 THEN
                    v_warning := format('Stripe renewal matched no profiles for subscription_id %s', p_subscription_id);
                END IF;
            END IF;

        ELSIF p_action = 'lapse_pro' THEN
            -- Recoverable payment lapse (past_due / unpaid / repeated invoice.payment_failed). The
            -- subscription still EXISTS at Stripe and can recover, so access is suspended (status 'free')
            -- but stripe_subscription_id is PRESERVED — otherwise a later invoice.payment_succeeded
            -- (renew_pro, keyed on the subscription id) could not find the profile and the customer would
            -- be stuck on Free after a successful recovery. Safe: effective_subscription_tier requires
            -- status='pro' AND a real sub id, so a retained sub id on a 'free' row never grants Pro.
            -- Terminal cancellation (subscription.deleted / canceled) still CLEARS the id via
            -- downgrade_to_free below. The one-time sample is not burned on a recoverable lapse.
            IF p_subscription_id IS NULL THEN
                RAISE EXCEPTION 'Missing subscription_id for lapse';
            END IF;

            SELECT last_stripe_event_at INTO v_last_at
            FROM public.user_profiles WHERE stripe_subscription_id = p_subscription_id FOR UPDATE;
            v_found := FOUND;

            IF v_found AND v_event_at IS NOT NULL AND v_last_at IS NOT NULL AND v_last_at >= v_event_at THEN
                v_success := true;
                v_warning := 'ignored_out_of_order';
            ELSE
                UPDATE public.user_profiles
                SET subscription_status = 'free',
                    last_stripe_event_at = GREATEST(COALESCE(last_stripe_event_at, to_timestamp(0)), COALESCE(v_event_at, to_timestamp(0))),
                    updated_at = now()
                WHERE stripe_subscription_id = p_subscription_id;

                GET DIAGNOSTICS v_rows = ROW_COUNT;
                IF v_rows > 1 THEN
                    RAISE EXCEPTION 'Stripe lapse affected % profiles for subscription_id %', v_rows, p_subscription_id;
                ELSIF v_rows = 0 THEN
                    v_warning := format('Stripe lapse matched no profiles for subscription_id %s', p_subscription_id);
                END IF;
            END IF;

        ELSIF p_action IN ('downgrade_to_free', 'downgrade_to_basic') THEN
            IF p_subscription_id IS NULL THEN
                RAISE EXCEPTION 'Missing subscription_id for downgrade';
            END IF;

            -- Out-of-order guard (subscription-keyed). A stale downgrade older than the newest applied
            -- event is ignored so it cannot regress a subsequently-renewed subscription.
            SELECT last_stripe_event_at INTO v_last_at
            FROM public.user_profiles WHERE stripe_subscription_id = p_subscription_id FOR UPDATE;
            v_found := FOUND;

            IF v_found AND v_event_at IS NOT NULL AND v_last_at IS NOT NULL AND v_last_at >= v_event_at THEN
                v_success := true;
                v_warning := 'ignored_out_of_order';
            ELSE
                -- Paid->free downgrade: clear BOTH paid-id columns, set Free, burn the one-time Private
                -- sample so a downgraded user cannot regain it, preserve stripe_customer_id.
                UPDATE public.user_profiles
                SET subscription_status = 'free',
                    stripe_subscription_id = NULL,
                    subscription_id = NULL,
                    private_sample_seconds_used = COALESCE(private_sample_limit_seconds, 300),
                    private_sample_completed_at = COALESCE(private_sample_completed_at, now()),
                    last_stripe_event_at = GREATEST(COALESCE(last_stripe_event_at, to_timestamp(0)), COALESCE(v_event_at, to_timestamp(0))),
                    updated_at = now()
                WHERE stripe_subscription_id = p_subscription_id;

                GET DIAGNOSTICS v_rows = ROW_COUNT;
                IF v_rows > 1 THEN
                    RAISE EXCEPTION 'Stripe downgrade affected % profiles for subscription_id %', v_rows, p_subscription_id;
                ELSIF v_rows = 0 THEN
                    v_warning := format('Stripe downgrade matched no profiles for subscription_id %s', p_subscription_id);
                END IF;
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

-- Preserve the prior 6-arg signature as a thin shim so the PRE-#1282 Edge webhook keeps working against
-- this migration (old Edge + new DB). Defaults on args 4-6 match the pre-#1282 function exactly; because
-- the 7-arg form above has NO defaults, a 6-arg call resolves unambiguously to this shim.
CREATE OR REPLACE FUNCTION public.process_stripe_webhook_event(
    p_event_id text,
    p_event_type text,
    p_action text,
    p_user_id uuid DEFAULT NULL,
    p_subscription_id text DEFAULT NULL,
    p_stripe_customer_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.process_stripe_webhook_event(
        p_event_id, p_event_type, p_action, p_user_id, p_subscription_id, p_stripe_customer_id, NULL::bigint
    );
$$;

REVOKE EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text, text, bigint) TO service_role;
REVOKE EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_stripe_webhook_event(text, text, text, uuid, text, text) TO service_role;
