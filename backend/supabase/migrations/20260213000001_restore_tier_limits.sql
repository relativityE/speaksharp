-- Migration: Restore Tier Limit Enforcement and Monthly Reset
-- Fixes regression introduced in 20260212000000_database_hardening.sql

CREATE OR REPLACE FUNCTION public.update_user_usage(session_duration_seconds int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_status text;
  v_current_usage int;
  v_last_reset timestamptz;
  v_limit_seconds int := 3600; -- 1 hour (Sync with frontend constants)
BEGIN
  -- 1. Get current state with Row Lock to prevent concurrent usage bypass
  SELECT subscription_status, usage_seconds, usage_reset_date
  INTO v_user_status, v_current_usage, v_last_reset
  FROM public.user_profiles
  WHERE id = auth.uid()
  FOR UPDATE;

  -- 2. Handle Monthly Reset logic
  IF v_last_reset IS NULL OR v_last_reset <= now() - interval '1 month' THEN
    v_current_usage := 0;
    v_last_reset := now();

    UPDATE public.user_profiles
    SET
        usage_seconds = 0,
        usage_reset_date = v_last_reset,
        updated_at = now()
    WHERE id = auth.uid();

    -- After reset, the check below will use v_current_usage = 0
  END IF;

  -- 3. Enforce Limit for Free Users
  -- We allow the current session to proceed if they haven't hit the limit YET.
  -- This matches the PRD: "Daily limit logic enforced ... hit their limit mid-session ... cleanly terminated".
  -- Actually, PRD says: "What happens when a user hits their limit mid-session? Is the session cleanly terminated or does it hang?"
  -- If we check >= limit here, it means if they are at 1799, they can add another session.
  -- If they are at 1800, they cannot.
  IF v_user_status = 'free' AND v_current_usage >= v_limit_seconds THEN
    RETURN false;
  END IF;

  -- 4. Perform Atomic Update
  UPDATE public.user_profiles
  SET
    usage_seconds = usage_seconds + session_duration_seconds,
    updated_at = now()
  WHERE id = auth.uid();

  RETURN FOUND;
END;
$$;

-- Also update check_usage_limit for consistency
CREATE OR REPLACE FUNCTION public.check_usage_limit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_usage int;
  last_reset timestamptz;
  user_status text;
  free_tier_limit_seconds int := 3600; -- 1 hour (Sync with frontend constants)
  remaining_seconds int;
  can_start boolean;
BEGIN
  -- Get current usage, reset date, and subscription status for the user
  SELECT
    coalesce(usage_seconds, 0),
    usage_reset_date,
    subscription_status
  INTO
    current_usage,
    last_reset,
    user_status
  FROM public.user_profiles
  WHERE id = auth.uid();

  -- Handle case where user profile doesn't exist
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'can_start', true,
      'remaining_seconds', free_tier_limit_seconds,
      'limit_seconds', free_tier_limit_seconds,
      'subscription_status', 'unknown',
      'error', 'Profile not found'
    );
  END IF;

  -- Reset usage if a new month has started
  IF last_reset IS NULL OR last_reset <= now() - interval '1 month' THEN
    current_usage := 0;
  END IF;

  -- Pro users have unlimited usage
  IF user_status = 'pro' THEN
    RETURN jsonb_build_object(
      'can_start', true,
      'remaining_seconds', -1, -- -1 indicates unlimited
      'limit_seconds', -1,
      'subscription_status', user_status,
      'is_pro', true
    );
  END IF;

  -- Calculate remaining for free users
  remaining_seconds := greatest(0, free_tier_limit_seconds - current_usage);
  can_start := remaining_seconds > 0;

  RETURN jsonb_build_object(
    'can_start', can_start,
    'remaining_seconds', remaining_seconds,
    'limit_seconds', free_tier_limit_seconds,
    'used_seconds', current_usage,
    'subscription_status', user_status,
    'is_pro', false
  );
END;
$$;
