-- Behavioral-harness bootstrap: the minimum trusted environment the P0 incident migrations depend on.
-- This is NOT a product schema — it is only enough of Supabase's shape (auth schema, roles, the two
-- authoritative tables) to exercise the migrations against a REAL PostgreSQL engine.

-- Supabase-style roles the migrations GRANT/REVOKE against. NOLOGIN; we reach them via SET ROLE.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN;          END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN;  END IF;
END $$;

-- Minimal auth schema + users stub (registry FKs auth.users(id) ON DELETE CASCADE).
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

-- Authoritative product tables (only the columns the migrations read).
CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'recording',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_issue_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The app inserts these tables as authenticated users through PostgREST; the harness inserts as the
-- bootstrap superuser (trigger firing does not depend on the writer's role). service_role must be able
-- to read the authoritative tables during reconcile (it runs SECURITY DEFINER, but grant anyway).
GRANT USAGE ON SCHEMA auth, public TO service_role;
GRANT SELECT ON public.sessions, public.user_issue_reports TO service_role;
