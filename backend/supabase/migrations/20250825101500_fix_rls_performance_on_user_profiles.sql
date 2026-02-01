-- Drop the four old, inefficient policies DROP POLICY IF EXISTS "Users can view their own sessions" ON public.sessions; DROP POLICY IF EXISTS "Users can insert their own sessions" ON public.sessions; DROP POLICY IF EXISTS "Users can update their own sessions" ON public.sessions; DROP POLICY IF EXISTS "Users can delete their own sessions" ON public.sessions;

-- Create the new, single, efficient policy CREATE POLICY "Users can manage own sessions" ON public.sessions FOR ALL USING ((select auth.uid()) = user_id);
