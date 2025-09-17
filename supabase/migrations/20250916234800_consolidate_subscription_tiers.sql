-- First, create a new type without 'premium'
CREATE TYPE subscription_status_new AS ENUM ('free', 'pro');

-- Update existing 'premium' users to 'pro' before changing the type
UPDATE public.user_profiles
SET subscription_status = 'pro'::public.subscription_status
WHERE subscription_status = 'premium';

-- Update the user_profiles table to use the new type
-- This involves altering the column type, which requires a USING clause
-- to cast the old enum values to the new enum values.
ALTER TABLE public.user_profiles
ALTER COLUMN subscription_status TYPE subscription_status_new
USING (subscription_status::text::subscription_status_new);

-- Drop the old enum type
DROP TYPE public.subscription_status;

-- Rename the new type to the original name
ALTER TYPE subscription_status_new RENAME TO subscription_status;


-- Now, update the RPC function to correctly handle usage limits
-- and reflect the consolidated 'pro' tier.
create or replace function update_user_usage(p_user_id uuid, p_session_duration_seconds int)
returns boolean
language plpgsql
security definer
as $$
declare
  current_usage int;
  last_reset timestamptz;
  user_status text;
  free_tier_limit_seconds int := 1800; -- 30 minutes for free users
  usage_exceeded boolean := false;
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
  where id = p_user_id;

  -- Return early if profile not found
  if not found then
    return false;
  end if;

  -- Reset usage if a new month has started
  if last_reset is null or last_reset <= date_trunc('month', now()) then
    current_usage := 0;
    last_reset := date_trunc('month', now());
    update public.user_profiles
    set
      usage_seconds = 0,
      usage_reset_date = last_reset
    where id = p_user_id;
  end if;

  -- Only check usage limits for 'free' users
  if user_status = 'free' then
    if current_usage >= free_tier_limit_seconds then
      -- If usage is already at or over the limit, set the flag and do not add more time.
      usage_exceeded := true;
    else
      -- If adding the new session duration exceeds the limit, cap it.
      if current_usage + p_session_duration_seconds > free_tier_limit_seconds then
        p_session_duration_seconds := free_tier_limit_seconds - current_usage;
        usage_exceeded := true;
      end if;

      -- Update the usage with the new (potentially capped) session's duration
      update public.user_profiles
      set usage_seconds = current_usage + p_session_duration_seconds
      where id = p_user_id;
    end if;
  else
    -- For 'pro' users, just update the usage without checking limits.
    update public.user_profiles
    set usage_seconds = current_usage + p_session_duration_seconds
    where id = p_user_id;
  end if;

  -- Return true if the limit was exceeded at any point during this check.
  return usage_exceeded;
end;
$$;
