-- Migration: Add check_usage_limit function for pre-session validation
-- This allows the frontend to check if a user can start a session BEFORE recording
-- Problem: Previously, usage was only checked when SAVING a session, leading to frustration
-- when users recorded for several minutes only to find they couldn't save.

create or replace function check_usage_limit()
returns jsonb
language plpgsql
security definer
as $$
declare
  current_usage int;
  last_reset timestamptz;
  user_status text;
  free_tier_limit_seconds int := 1800; -- 30 minutes
  remaining_seconds int;
  can_start boolean;
begin
  -- Get current usage, reset date, and subscription status for the user
  select
    coalesce(usage_seconds, 0),
    usage_reset_date,
    subscription_status
  into
    current_usage,
    last_reset,
    user_status
  from public.user_profiles
  where id = auth.uid();

  -- Handle case where user profile doesn't exist
  if not found then
    return jsonb_build_object(
      'can_start', true,
      'remaining_seconds', free_tier_limit_seconds,
      'limit_seconds', free_tier_limit_seconds,
      'subscription_status', 'unknown',
      'error', 'Profile not found'
    );
  end if;

  -- Reset usage if a new month has started (but don't UPDATE here - just calculate)
  if last_reset is null or last_reset <= now() - interval '1 month' then
    current_usage := 0;
  end if;

  -- Pro users have unlimited usage
  if user_status = 'pro' then
    return jsonb_build_object(
      'can_start', true,
      'remaining_seconds', -1, -- -1 indicates unlimited
      'limit_seconds', -1,
      'subscription_status', user_status,
      'is_pro', true
    );
  end if;

  -- Calculate remaining for free users
  remaining_seconds := greatest(0, free_tier_limit_seconds - current_usage);
  can_start := remaining_seconds > 0;

  return jsonb_build_object(
    'can_start', can_start,
    'remaining_seconds', remaining_seconds,
    'limit_seconds', free_tier_limit_seconds,
    'used_seconds', current_usage,
    'subscription_status', user_status,
    'is_pro', false
  );
end;
$$;

-- Grant execute permission to authenticated users
grant execute on function check_usage_limit() to authenticated;
