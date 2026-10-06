#!/usr/bin/env bash
# #1258 F3 — bootstrap a disposable Postgres for the Progress history PostgREST proof
# (tests/http/progress-history-postgrest.http.ts).
#
# Supabase-shaped roles and auth shim, a minimal owner-scoped `sessions` table, then the REAL Progress migration chain,
# so PostgREST sees exactly the relationships those migrations define — including the THREE foreign keys from
# session_progress_evaluations to sessions that make an un-hinted embed ambiguous. No blanket grant is added:
# `authenticated` reads only what the migrations (and the owner-scoped sessions policy) allow. Requires psql + PG* env.
set -euo pipefail
M=backend/supabase/migrations
PSQL="psql -v ON_ERROR_STOP=1 -qAt"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

$PSQL >/dev/null <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth;
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $r$;
GRANT anon, authenticated, service_role TO CURRENT_USER;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
-- Owner-scoped sessions, as on Supabase: the history read is filtered by RLS, never by a client-side user filter.
CREATE TABLE public.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
-- PostgREST v12 sets request.jwt.claims (JSON); accept the legacy claim too. A harness shim, as in run-postgrest-contract-proof.sh.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true)::json->>'sub', ''))::uuid
$fn$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(nullif(current_setting('request.jwt.claims', true)::json->>'role', ''), 'anon')
$fn$;
CREATE POLICY sessions_select_own ON public.sessions FOR SELECT USING (auth.uid() = user_id);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated;
GRANT SELECT ON public.sessions TO authenticated;
SQL
for f in 20260731120000_session_progress_evaluations.sql 20260731130000_progress_recommendations.sql; do
  $PSQL -f "$M/$f" >/dev/null
done
$PSQL -c "NOTIFY pgrst, 'reload schema';" >/dev/null
echo "bootstrap: spe->sessions fkeys=$($PSQL -c "SELECT string_agg(conname || '(' || a.attname || ')', ',' ORDER BY conname)
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.session_progress_evaluations'::regclass AND c.contype = 'f' AND c.confrelid = 'public.sessions'::regclass")"
