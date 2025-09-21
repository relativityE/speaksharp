-- 1. Rename column for clarity and consistency with app logic (which uses seconds)
alter table public.user_profiles
rename column usage_minutes to usage_seconds;

-- 2. Create the RPC function to update usage and handle monthly resets
create or replace function update_user_usage(session_duration_seconds int)
returns boolean
language plpgsql
security definer
as $$
declare
  current_usage int;
  last_reset timestamptz;
  user_status text;
  free_tier_limit_seconds int := 1800; -- 30 minutes
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

  -- Reset usage if a new month has started
  if last_reset is null or last_reset <= now() - interval '1 month' then
    current_usage := 0;
    update public.user_profiles
    set
      usage_seconds = 0,
      usage_reset_date = now()
    where id = auth.uid();
  end if;

  -- Enforce usage limit for free tier users
  if user_status = 'free' and current_usage >= free_tier_limit_seconds then
    -- User has already exceeded the limit, deny the request to add more usage.
    return false;
  end if;

  -- Update the usage with the new session's duration
  update public.user_profiles
  set usage_seconds = current_usage + session_duration_seconds
  where id = auth.uid();

  return true;
end;
$$;
