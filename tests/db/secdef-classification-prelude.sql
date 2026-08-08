-- #1097 PR-A — disposable-Postgres prelude for the SECURITY DEFINER classification harness.
--
-- Purpose: stub ONLY what a hosted Supabase project preinstalls that a bare `postgres` container lacks, so
-- the committed migrations under backend/supabase/migrations/*.sql can be applied VERBATIM (no edits) and the
-- resulting effective privilege state can be introspected. This prelude establishes environment, never
-- product objects — every table/function/policy/grant under test comes from the real migrations.
--
-- This runs against a THROWAWAY container in CI. It uses NO hosted credential and touches NO hosted database.

-- Supabase's standard roles. Migrations GRANT/REVOKE against these; a bare engine has none of them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')           THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')  THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')   THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator')  THEN CREATE ROLE authenticator NOINHERIT LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin; END IF;
  -- PostgREST's authenticator can switch into the request roles; mirror that so grants resolve as in prod.
  GRANT anon, authenticated, service_role TO authenticator;
END $$;

-- Extensions the migrations rely on (present on hosted Supabase). uuid-ossp provides uuid_generate_v4();
-- pgcrypto provides gen_random_uuid()/digest() etc. Both ship with the postgres:15/16/17 images.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase's auth + storage schemas and the auth helper functions the migrations reference in policies,
-- defaults, and function bodies. Bodies are faithful enough for DDL to apply and for privilege introspection;
-- this harness asserts GRANT/REVOKE + search_path, not runtime authz behaviour.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()   RETURNS uuid  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',  true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role()  RETURNS text  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.email', true), '') $$;
CREATE OR REPLACE FUNCTION auth.jwt()   RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

-- Supabase grants the request roles USAGE on public by default; migrations assume it exists.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
