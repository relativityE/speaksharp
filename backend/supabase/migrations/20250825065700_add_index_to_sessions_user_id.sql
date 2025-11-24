-- Add an index to the user_id foreign key on the sessions table for faster lookups
CREATE INDEX sessions_user_id_idx ON public.sessions (user_id);
