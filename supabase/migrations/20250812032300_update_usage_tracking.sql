-- 1. Rename column for clarity and consistency with app logic (which uses seconds)
alter table public.user_profiles
rename column usage_minutes to usage_seconds;

-- 2. Create the RPC function to update usage and handle monthly resets
create or replace function update_user_usage(session_duration_seconds int)
returns void
language plpgsql
security definer
as $$
declare
  current_usage int;
  last_reset timestamptz;
begin
  -- Get current usage and reset date for the user
  select
    usage_seconds,
    usage_reset_date
  into
    current_usage,
    last_reset
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

  -- Update the usage with the new session's duration
  update public.user_profiles
  set usage_seconds = current_usage + session_duration_seconds
  where id = auth.uid();
end;
$$;
