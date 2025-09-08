-- WARNING: This migration disables Row Level Security for the sessions table
-- to allow the client-side 'dev' user to function for testing purposes.
-- This is a security risk and should NOT be applied to a production environment.
-- A better long-term solution is to use a real 'dev' user in the database
-- for testing instead of a client-side mock.

-- First, drop the existing policy
DROP POLICY "Users can manage own sessions" ON public.sessions;

-- Then, create a new policy that allows all access.
CREATE POLICY "Users can manage own sessions" ON public.sessions
FOR ALL
USING (true)
WITH CHECK (true);

-- Also update the user_profiles policy to be permissive for the dev user.
-- This is also a security risk.
DROP POLICY "Users can view own profile" ON public.user_profiles;

CREATE POLICY "Users can view own profile" ON public.user_profiles
FOR SELECT
USING (true);
