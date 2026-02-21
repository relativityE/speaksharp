-- Migration: Standardize Tier Limits and Fix Enforcement Regression
-- 1. Standardize Free Tier limit to 3600s (1 hour) daily across all functions.
-- 2. Restore usage limit enforcement in update_user_usage RPC.

-- Fix update_user_usage to enforce limit while remaining atomic
CREATE OR REPLACE FUNCTION public.update_user_usage(session_duration_seconds int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  free_tier_limit_seconds int := 3600; -- 1 hour (Standardized)
BEGIN
  -- Perform atomic update with limit enforcement for free users
  -- We allow the user to finish their current session even if it pushes them slightly over 1 hour,
  -- but we block ANY new updates if they are already at or over the limit.
  UPDATE public.user_profiles
  SET
    usage_seconds = usage_seconds + session_duration_seconds,
    updated_at = now()
  WHERE id = auth.uid()
    AND (subscription_status = 'pro' OR usage_seconds < free_tier_limit_seconds);

  -- Return true if the user was found and updated
  RETURN FOUND;
END;
$$;

-- Fix check_usage_limit to match standardized 1 hour daily limit
CREATE OR REPLACE FUNCTION public.check_usage_limit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_usage int;
  last_reset timestamptz;
  user_status text;
  free_tier_limit_seconds int := 3600; -- 1 hour (Standardized)
  remaining_seconds int;
  can_start boolean;
  now_timestamp timestamptz := now();
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

  -- DAILY RESET LOGIC: Match Edge Function behavior (24h reset)
  IF last_reset IS NULL OR (now_timestamp - last_reset) >= interval '24 hours' THEN
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
