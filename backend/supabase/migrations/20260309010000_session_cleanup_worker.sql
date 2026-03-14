-- backend/supabase/migrations/20260309010000_session_cleanup_worker.sql

-- Function to cleanup sessions that have exceeded their expires_at time
-- This should be called periodically by a pg_cron job or a backend worker
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INT;
BEGIN
    UPDATE public.sessions
    SET status = 'expired',
        updated_at = now()
    WHERE status = 'active'
      AND expires_at < now();
      
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RETURN jsonb_build_object(
        'success', true,
        'sessions_expired', v_count
    );
END;
$$;

-- Function to explicitly complete a session
CREATE OR REPLACE FUNCTION public.complete_session(
    p_session_id UUID,
    p_final_transcript TEXT DEFAULT NULL,
    p_final_duration INT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.sessions
    SET status = 'completed',
        transcript = COALESCE(p_final_transcript, transcript),
        duration = COALESCE(p_final_duration, duration),
        updated_at = now()
    WHERE id = p_session_id AND user_id = auth.uid();
    
    RETURN jsonb_build_object('success', true);
END;
$$;
