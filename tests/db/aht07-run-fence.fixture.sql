-- Fixture Auth for the AHT-07 run-fence proof: the minimum of Supabase's roles, auth.users, auth.sessions, auth.uid()
-- and auth.jwt() (claims from request.jwt.claims, as PostgREST sets them). Then the real user_issue_reports chain.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE postgres_owner NOLOGIN;            -- stands in for the migration owner (not a superuser)
GRANT anon, authenticated, service_role TO postgres_owner;
GRANT ALL ON SCHEMA public TO postgres_owner;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth TO postgres_owner, anon, authenticated, service_role;
GRANT SELECT, REFERENCES ON auth.users, auth.sessions TO postgres_owner;
GRANT TRIGGER ON auth.users TO postgres_owner;  -- the repo already ships AFTER INSERT / BEFORE DELETE triggers on auth.users
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO PUBLIC;

-- Supabase's default privileges: every new public table, function and sequence is granted to anon, authenticated and
-- service_role unless a migration revokes it. Simulated here so the proof sees the grants production would.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres_owner IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres_owner IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres_owner IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Minimal app sessions table (the ownership guard reads it); cascades from the account like production.
SET ROLE postgres_owner;
CREATE TABLE public.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
RESET ROLE;
