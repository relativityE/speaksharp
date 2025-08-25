-- Drop the four old, inefficient policies
DROP POLICY "Users can view their own sessions" ON public.sessions;
DROP POLICY "Users can insert their own sessions" ON public.sessions;
DROP POLICY "Users can update their own sessions" ON public.sessions;
DROP POLICY "Users can delete their own sessions" ON public.sessions;

-- Create the new, single, efficient policy
CREATE POLICY "Users can manage own sessions" ON public.sessions
FOR ALL USING ((select auth.uid()) = user_id);
