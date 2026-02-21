-- 1. Atomic Usage Update with Limit Enforcement (Fixes Domain 7, Area 13)
-- Replaces the simple increment with one that checks the daily limit.
-- Uses FOR UPDATE to prevent race conditions during concurrent saves.

CREATE OR REPLACE FUNCTION public.update_user_usage(session_duration_seconds int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_usage_seconds int;
    v_subscription_status text;
    v_limit_seconds int := 3600; -- 1 hour per day (Alpha Launch spec)
    v_reset_date timestamptz;
BEGIN
    -- 1. Get current state and Lock the row to prevent concurrent updates
    SELECT usage_seconds, subscription_status, usage_reset_date
    INTO v_usage_seconds, v_subscription_status, v_reset_date
    FROM public.user_profiles
    WHERE id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- 2. Handle Daily Reset (Expert Fix: Server-side authoritative reset)
    IF v_reset_date IS NULL OR v_reset_date <= now() - interval '24 hours' THEN
        v_usage_seconds := 0;
        UPDATE public.user_profiles
        SET usage_seconds = 0, usage_reset_date = now()
        WHERE id = auth.uid();
    END IF;

    -- 3. Pro users have no limit
    IF v_subscription_status = 'pro' THEN
        UPDATE public.user_profiles
        SET
            usage_seconds = v_usage_seconds + session_duration_seconds,
            updated_at = now()
        WHERE id = auth.uid();
        RETURN TRUE;
    END IF;

    -- 4. Check limit for free users
    IF (v_usage_seconds + session_duration_seconds) > v_limit_seconds THEN
        RETURN FALSE;
    END IF;

    -- 5. Apply update
    UPDATE public.user_profiles
    SET
        usage_seconds = v_usage_seconds + session_duration_seconds,
        updated_at = now()
    WHERE id = auth.uid();

    RETURN TRUE;
END;
$$;

-- REDEFINE create_session_and_update_usage to use the hardened logic
-- This ensures that existing frontend calls benefit from row-level locking.
CREATE OR REPLACE FUNCTION create_session_and_update_usage(
    p_session_data JSONB,
    p_is_free_user BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_session_id UUID;
    v_duration INT;
    v_usage_exceeded BOOLEAN := FALSE;
    v_result JSONB;
BEGIN
    v_duration := (p_session_data->>'duration')::INT;

    -- INTEGRATION SAFETY: Guard against 0-second or 0-word sessions
    IF v_duration < 1 OR (p_session_data->>'total_words')::INT = 0 OR p_session_data->>'transcript' IS NULL OR p_session_data->>'transcript' = '' THEN
        RETURN json_build_object(
            'new_session', null,
            'usage_exceeded', false,
            'reason', 'Session too short or empty'
        );
    END IF;

    -- 1. Update Usage if free user (Hardened with FOR UPDATE)
    IF p_is_free_user THEN
        IF NOT update_user_usage(v_duration) THEN
            v_usage_exceeded := TRUE;
            RETURN json_build_object(
                'new_session', null,
                'usage_exceeded', true
            );
        END IF;
    END IF;

    -- 2. Insert Session
    INSERT INTO public.sessions (
        user_id,
        title,
        duration,
        total_words,
        filler_words,
        accuracy,
        ground_truth,
        transcript,
        engine,
        clarity_score,
        wpm
    ) VALUES (
        auth.uid(),
        p_session_data->>'title',
        v_duration,
        (p_session_data->>'total_words')::INT,
        (p_session_data->'filler_words')::JSONB,
        (p_session_data->>'accuracy')::FLOAT8,
        p_session_data->>'ground_truth',
        p_session_data->>'transcript',
        p_session_data->>'engine',
        (p_session_data->>'clarity_score')::FLOAT8,
        (p_session_data->>'wpm')::FLOAT8
    ) RETURNING id INTO v_new_session_id;

    -- 3. Prepare result
    SELECT json_build_object(
        'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_new_session_id),
        'usage_exceeded', v_usage_exceeded
    ) INTO v_result;

    RETURN v_result;
END;
$$;
