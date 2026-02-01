-- Set a secure search_path for the function to mitigate security risks.
alter function public.update_user_usage(session_duration_seconds int)
  set search_path = public;
