-- =============================================================================
-- Migration: Process Stripe Webhook Event RPC
-- =============================================================================
--
-- PURPOSE: Optimize Stripe webhook processing by combining idempotency check
--          and user profile updates into a single atomic database round-trip.
--          This prevents race conditions and eliminates the need for manual
--          rollback of the idempotency lock upon failure.
--
-- =============================================================================

CREATE OR REPLACE FUNCTION process_stripe_webhook_event(
    p_event_id TEXT,
    p_event_type TEXT,
    p_user_id UUID DEFAULT NULL,
    p_subscription_id TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_attempt_count INT DEFAULT 0
) RETURNS JSON AS $$
DECLARE
    v_existing_id UUID;
    v_action TEXT := 'no_action';
BEGIN
    -- 1. Idempotency Lock
    -- We try to insert first. Unique constraint on 'event_id' handles the lock.
    BEGIN
        INSERT INTO processed_webhook_events (event_id, event_type, processed_at)
        VALUES (p_event_id, p_event_type, NOW())
        RETURNING id INTO v_existing_id;
    EXCEPTION WHEN unique_violation THEN
        RETURN json_build_object('success', true, 'skipped', true, 'message', 'Event already processed or in progress');
    END;

    -- 2. Process Business Logic based on Event Type
    IF p_event_type = 'checkout.session.completed' THEN
        IF p_user_id IS NULL THEN
            RAISE EXCEPTION 'Missing userId metadata';
        END IF;

        UPDATE user_profiles
        SET subscription_status = 'pro', stripe_subscription_id = p_subscription_id
        WHERE id = p_user_id;
        v_action := 'upgraded';

    ELSIF p_event_type = 'customer.subscription.deleted' THEN
        UPDATE user_profiles
        SET subscription_status = 'free', stripe_subscription_id = NULL
        WHERE stripe_subscription_id = p_subscription_id;
        v_action := 'downgraded';

    ELSIF p_event_type = 'customer.subscription.updated' THEN
        IF p_status IN ('canceled', 'unpaid', 'past_due') THEN
            UPDATE user_profiles
            SET subscription_status = 'free'
            WHERE stripe_subscription_id = p_subscription_id;
            v_action := 'downgraded';
        END IF;

    ELSIF p_event_type = 'invoice.payment_failed' THEN
        IF p_attempt_count >= 3 AND p_subscription_id IS NOT NULL THEN
            UPDATE user_profiles
            SET subscription_status = 'free'
            WHERE stripe_subscription_id = p_subscription_id;
            v_action := 'downgraded';
        END IF;
    END IF;

    -- If no exception is raised, the transaction commits automatically.
    RETURN json_build_object('success', true, 'skipped', false, 'action', v_action);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
