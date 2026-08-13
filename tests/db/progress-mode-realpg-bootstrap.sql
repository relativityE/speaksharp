-- Disposable-only support object required by the #1265 migration. Production creates this table in the
-- Focus Points chain; the matrix keeps only the server-owned mode marker shape consumed by Progress.
CREATE TABLE IF NOT EXISTS public.objective_source_recording (
    session_id uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    registered_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.objective_source_recording FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.objective_source_recording TO service_role;
