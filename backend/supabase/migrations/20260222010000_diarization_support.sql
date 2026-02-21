-- Migration: Diarization Support
-- 1. Add phrases column to sessions table to store diarized transcript parts.
-- 2. Update create_session_and_update_usage RPC to handle phrases.

-- Add phrases column
ALTER TABLE public.sessions
ADD COLUMN IF NOT EXISTS phrases JSONB DEFAULT '[]';

-- Update RPC to include phrases
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

    -- 1. Update Usage if free user
    IF p_is_free_user THEN
        -- Call the existing usage update function
        IF NOT update_user_usage(v_duration) THEN
            v_usage_exceeded := TRUE;
            -- Return early with usage_exceeded=true if limit hit
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
        wpm,
        phrases
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
        (p_session_data->>'wpm')::FLOAT8,
        COALESCE((p_session_data->'phrases')::JSONB, '[]'::JSONB)
    ) RETURNING id INTO v_new_session_id;

    -- 3. Prepare result
    SELECT json_build_object(
        'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_new_session_id),
        'usage_exceeded', v_usage_exceeded
    ) INTO v_result;

    RETURN v_result;
END;
$$;
