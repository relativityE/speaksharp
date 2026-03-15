-- =============================================================================
-- Migration: process_stripe_webhook_event RPC
-- =============================================================================
--
-- PURPOSE: Optimizes Stripe webhook throughput by combining the idempotency check
--          and user profile update into a single atomic database round-trip.
-- =============================================================================

CREATE OR REPLACE FUNCTION process_stripe_webhook_event(
    p_event_id text,
    p_event_type text,
    p_action text,
    p_user_id uuid DEFAULT NULL,
    p_subscription_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_success boolean := false;
    v_skipped boolean := false;
    v_error text := NULL;
BEGIN
    -- 1. Idempotency Check (Insert)
    BEGIN
        INSERT INTO processed_webhook_events (event_id, event_type, processed_at)
        VALUES (p_event_id, p_event_type, NOW());
    EXCEPTION WHEN unique_violation THEN
        -- Event already processed
        RETURN jsonb_build_object('success', true, 'skipped', true);
    END;

    -- 2. Process Action
    BEGIN
        IF p_action = 'upgrade_to_pro' THEN
            IF p_user_id IS NULL THEN
                RAISE EXCEPTION 'Missing user_id for upgrade';
            END IF;

            UPDATE user_profiles
            SET subscription_status = 'pro',
                stripe_subscription_id = p_subscription_id
            WHERE id = p_user_id;

        ELSIF p_action = 'downgrade_to_free' THEN
            IF p_subscription_id IS NULL THEN
                RAISE EXCEPTION 'Missing subscription_id for downgrade';
            END IF;

            IF p_event_type = 'customer.subscription.deleted' THEN
                UPDATE user_profiles
                SET subscription_status = 'free',
                    stripe_subscription_id = NULL
                WHERE stripe_subscription_id = p_subscription_id;
            ELSE
                UPDATE user_profiles
                SET subscription_status = 'free'
                WHERE stripe_subscription_id = p_subscription_id;
            END IF;

        ELSIF p_action = 'none' THEN
            -- Just idempotency was needed
            NULL;
        ELSE
            RAISE EXCEPTION 'Unknown action: %', p_action;
        END IF;

        v_success := true;
    EXCEPTION WHEN OTHERS THEN
        -- If the action fails, rollback the idempotency insert so it can be retried
        DELETE FROM processed_webhook_events WHERE event_id = p_event_id;
        v_success := false;
        v_error := SQLERRM;
    END;

    RETURN jsonb_build_object('success', v_success, 'skipped', v_skipped, 'error', v_error);
END;
$$;

-- Security: Prevent arbitrary users from calling this RPC to upgrade their accounts
REVOKE EXECUTE ON FUNCTION process_stripe_webhook_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION process_stripe_webhook_event TO service_role;
