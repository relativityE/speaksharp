-- Drop the old, inefficient RLS policy
drop policy "Users can view own profile" on public.user_profiles;

-- Create a new, performant RLS policy
create policy "Users can view own profile" on public.user_profiles
  for all using ((select auth.uid()) = id);
