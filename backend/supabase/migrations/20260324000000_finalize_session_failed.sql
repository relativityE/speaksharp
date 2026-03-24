-- backend/supabase/migrations/20260324000000_finalize_session_failed.sql

-- 1. Add status_reason and updated_at columns to sessions for failure metadata
ALTER TABLE public.sessions 
ADD COLUMN IF NOT EXISTS status_reason TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Update status column documentation/comment
COMMENT ON COLUMN public.sessions.status IS 'active, completed, expired, failed';

-- 3. Refactor complete_session RPC to support status and reason
-- This ensures the invariant "Deterministic Failure Finalization"
DROP FUNCTION IF EXISTS public.complete_session(UUID, TEXT, TEXT, INT, TEXT);
DROP FUNCTION IF EXISTS public.complete_session(UUID, TEXT, INT);

CREATE OR REPLACE FUNCTION public.complete_session(
    p_session_id UUID,
    p_status TEXT DEFAULT 'completed', -- 'completed' or 'failed'
    p_final_transcript TEXT DEFAULT NULL,
    p_final_duration INT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.sessions
    SET status = p_status,
        status_reason = COALESCE(p_reason, status_reason),
        transcript = COALESCE(p_final_transcript, transcript),
        duration = COALESCE(p_final_duration, duration),
        updated_at = now()
    WHERE id = p_session_id AND user_id = auth.uid();
    
    RETURN jsonb_build_object(
        'success', true,
        'final_status', p_status
    );
END;
$$;
