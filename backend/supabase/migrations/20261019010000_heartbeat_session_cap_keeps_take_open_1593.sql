-- #1593 (live RWT case 12, run 39167876945) — A TAKE THAT REACHES THE 600 s CAP STAYS OPEN FOR ITS DEVICE'S SAVE.
--
-- heartbeat_session (20260812041500_flawless_launch_runtime_convergence_1290.sql) marked the row `completed` /
-- `technical_duration_cap` the moment its accrued duration reached 600 s — with no metrics, no next action and no
-- transcript. The client auto-stops at the same 600 s (useSessionLifecycle, MAX_PRIVATE_RECORDING_SECONDS) and then sends
-- the take's real completion, which complete_session_v2 refused as an idempotency conflict: the take's save was lost and
-- Retry Save could never succeed.
--
-- The cap stays server-authoritative for BILLING: a heartbeat still accepts at most the seconds left under 600, accrues
-- nothing at the cap, and reports `at_cap`. What changes is that a heartbeat never FINALIZES the take: the row stays
-- `active` so the device's own completion (complete_session_v2, unchanged) saves it with its metrics, next action and
-- transcript, or discards it.
--   * The heartbeat that reaches 600 s extends the expiry as any heartbeat does, so the save has the same window.
--   * A heartbeat AT the cap accepts and bills nothing and does NOT extend the expiry: a device that never completes the
--     take still lets it expire on the ordinary path. It still writes the row (updated_at), so the #1476 fence judges it
--     exactly as below the cap — a displaced or fenced take is refused, never silently acknowledged.
--
-- Function replacement only: same signature, SECURITY DEFINER, pinned search_path and grants; no schema change.
-- complete_session_v2 and create_session_and_update_usage are unchanged. Rows the old heartbeat already closed at the cap
-- are NOT reopened here; their recovery is separate.

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
    v_status TEXT;
    v_duration INT;
    v_remaining INT;
    v_accepted_seconds INT;
    v_at_cap BOOLEAN;
BEGIN
    IF p_incremental_seconds IS NULL OR p_incremental_seconds < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_duration');
    END IF;

    SELECT engine, status, COALESCE(duration, 0)
    INTO v_engine_type, v_status, v_duration
    FROM public.sessions
    WHERE id = p_session_id AND user_id = auth.uid()
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
    END IF;
    IF v_status IS DISTINCT FROM 'active' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'session_not_active',
            'final_status', v_status,
            'at_cap', v_duration >= 600
        );
    END IF;

    v_remaining := GREATEST(0, 600 - v_duration);
    v_accepted_seconds := LEAST(p_incremental_seconds, v_remaining);
    v_at_cap := (v_duration + v_accepted_seconds >= 600);

    IF v_remaining = 0 THEN
        -- At the cap: nothing accepted or billed, the expiry is not extended, and the take stays open for its device's
        -- completion. The write lets the #1476 fence refuse a displaced or fenced take exactly as below the cap.
        UPDATE public.sessions
        SET updated_at = now()
        WHERE id = p_session_id AND user_id = auth.uid();
        RETURN jsonb_build_object(
            'success', true,
            'at_cap', true,
            'accepted_seconds', 0,
            'duration', 600,
            'remaining_seconds', 0,
            'final_status', 'active'
        );
    END IF;

    v_usage_check := public.update_user_usage(v_accepted_seconds, v_engine_type, p_session_id);
    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', v_usage_check->>'error',
            'subscription_status', v_usage_check->>'subscription_status'
        );
    END IF;

    UPDATE public.sessions
    SET duration = v_duration + v_accepted_seconds,
        expires_at = now() + interval '5 minutes',
        updated_at = now()
    WHERE id = p_session_id AND user_id = auth.uid();

    IF v_accepted_seconds > 0 THEN
        INSERT INTO public.usage_checkpoints (session_id, user_id, incremental_seconds, engine_type)
        VALUES (p_session_id, auth.uid(), v_accepted_seconds, v_engine_type);
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'subscription_status', v_usage_check->>'subscription_status',
        'at_cap', v_at_cap,
        'accepted_seconds', v_accepted_seconds,
        'duration', v_duration + v_accepted_seconds,
        'remaining_seconds', GREATEST(0, 600 - v_duration - v_accepted_seconds),
        'final_status', 'active'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat_session(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_session(UUID, INT) TO authenticated, service_role;
