-- =============================================================================
-- Migration: Add process_stripe_webhook_event RPC
-- =============================================================================
--
-- PURPOSE: Optimize stripe webhook processing by atomizing idempotency check
--          and user profile updates into a single database round-trip.
--

CREATE OR REPLACE FUNCTION process_stripe_webhook_event(
    p_event_id TEXT,
    p_event_type TEXT,
    p_user_id UUID DEFAULT NULL,
    p_subscription_id TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_attempt_count INT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    -- 1. Idempotency Check & Lock
    BEGIN
        INSERT INTO processed_webhook_events (event_id, event_type, processed_at)
        VALUES (p_event_id, p_event_type, NOW());
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', true, 'skipped', true, 'message', 'Event already processed or in progress');
    END;

    -- 2. Process Business Logic based on Event Type
    CASE p_event_type
        WHEN 'checkout.session.completed' THEN
            IF p_user_id IS NULL THEN
                -- Rollback idempotency record so it can be retried or fixed later
                DELETE FROM processed_webhook_events WHERE event_id = p_event_id;
                RETURN jsonb_build_object('success', false, 'error', 'Missing userId metadata', 'error_code', 'VALIDATION_MISSING_METADATA');
            END IF;

            UPDATE user_profiles
            SET subscription_status = 'pro', stripe_subscription_id = p_subscription_id
            WHERE id = p_user_id;

            v_result := jsonb_build_object('success', true, 'message', 'Upgraded to Pro');

        WHEN 'customer.subscription.deleted' THEN
            UPDATE user_profiles
            SET subscription_status = 'free', stripe_subscription_id = NULL
            WHERE stripe_subscription_id = p_subscription_id;

            v_result := jsonb_build_object('success', true, 'message', 'Downgraded to Free');

        WHEN 'customer.subscription.updated' THEN
            IF p_status IN ('canceled', 'unpaid', 'past_due') THEN
                UPDATE user_profiles
                SET subscription_status = 'free'
                WHERE stripe_subscription_id = p_subscription_id;

                v_result := jsonb_build_object('success', true, 'message', 'Downgraded to Free due to status');
            ELSE
                v_result := jsonb_build_object('success', true, 'message', 'No action needed');
            END IF;

        WHEN 'invoice.payment_failed' THEN
            IF p_attempt_count >= 3 AND p_subscription_id IS NOT NULL THEN
                UPDATE user_profiles
                SET subscription_status = 'free'
                WHERE stripe_subscription_id = p_subscription_id;

                v_result := jsonb_build_object('success', true, 'message', 'Downgraded to Free due to payment failure');
            ELSE
                v_result := jsonb_build_object('success', true, 'message', 'No action needed');
            END IF;

        ELSE
            -- We just record the event and do nothing
            v_result := jsonb_build_object('success', true, 'message', 'Unhandled event type recorded');
    END CASE;

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    -- If any unexpected DB error occurs, release the idempotency lock so Stripe can retry
    DELETE FROM processed_webhook_events WHERE event_id = p_event_id;
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'error_code', 'DATABASE_ERROR');
END;
$$;
