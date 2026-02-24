-- 1. Atomic Usage Update (Fixes Domain 7, Area 13)
-- Replaces non-atomic read-modify-write with a single atomic increment.

CREATE OR REPLACE FUNCTION public.update_user_usage(session_duration_seconds int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_limit_seconds INT := 3600; -- 1 hour (Alpha Launch Refactor)
  v_current_usage INT;
  v_last_reset TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  -- 1. Get current state and handle daily reset
  SELECT usage_seconds, usage_reset_date, subscription_status
  INTO v_current_usage, v_last_reset, v_status
  FROM public.user_profiles
  WHERE id = auth.uid()
  FOR UPDATE; -- Lock row for consistency

  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Daily reset (matching Edge Function logic)
  IF v_last_reset IS NULL OR v_last_reset <= now() - INTERVAL '24 hours' THEN
    v_current_usage := 0;
    v_last_reset := now();
  END IF;

  -- 2. Enforce limit for free users
  IF v_status = 'free' AND v_current_usage >= v_limit_seconds THEN
    RETURN FALSE;
  END IF;

  -- 3. Atomic update
  UPDATE public.user_profiles
  SET 
    usage_seconds = v_current_usage + session_duration_seconds,
    usage_reset_date = v_last_reset,
    updated_at = now()
  WHERE id = auth.uid();

  RETURN TRUE;
END;
$$;

-- 2. Orphan Protection (Fixes Domain 7, Area 14)
-- Ensures sessions and profiles are deleted when a user is removed.

-- First, drop existing constraints to recreate them with CASCADE
ALTER TABLE public.user_profiles 
DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_id_fkey 
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.sessions
DROP CONSTRAINT IF EXISTS sessions_user_id_fkey;

ALTER TABLE public.sessions
ADD CONSTRAINT sessions_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
