-- Ensure authenticated clients can use the sessions table through PostgREST.
-- RLS still restricts rows to auth.uid() = user_id.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sessions TO authenticated;
