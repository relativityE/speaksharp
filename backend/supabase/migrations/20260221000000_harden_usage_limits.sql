-- 1. Harden Tier Limit Enforcement (Fixes Domain 3, Area 11)
-- Updates update_user_usage to strictly enforce the 1-hour (3600s) limit for free users.

CREATE OR REPLACE FUNCTION public.update_user_usage(session_duration_seconds int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_limit int := 3600; -- Daily limit for free tier (Alpha Standard)
BEGIN
    -- Perform atomic update with integrated limit check (Prevents TOCTOU)
    -- We allow a "graceful overage" for the session that pushes them over (usage_seconds < v_limit),
    -- but subsequent sessions will be blocked because usage_seconds will then be >= v_limit.
    UPDATE public.user_profiles
    SET
      usage_seconds = usage_seconds + session_duration_seconds,
      updated_at = now()
    WHERE id = auth.uid()
    AND (subscription_status = 'pro' OR usage_seconds < v_limit);

    -- Return true if the user was found and updated (meaning they were under limit or Pro)
    RETURN FOUND;
END;
$$;

-- 2. Performance Optimization (Fixes Domain 5, Area 17)
-- Add composite index for paginated session history queries.
CREATE INDEX IF NOT EXISTS sessions_user_id_created_at_idx ON public.sessions (user_id, created_at DESC);
