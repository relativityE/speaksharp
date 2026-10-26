#!/usr/bin/env bash
# #1258 — bootstrap a disposable Postgres for the Share Feedback PostgREST proof (tests/http/share-feedback-postgrest.http.ts).
#
# Supabase-shaped roles and auth shim, then the REAL user_issue_reports migration chain. Unlike
# run-postgrest-contract-proof.sh, NO blanket table grant is added: `authenticated` holds exactly what the migrations
# grant (INSERT, no SELECT), because a harness SELECT grant would hide the defect under test. Requires psql + PG* env.
set -euo pipefail
M=backend/supabase/migrations
PSQL="psql -v ON_ERROR_STOP=1 -qAt"

$PSQL >/dev/null <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth;
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $r$;
GRANT anon, authenticated, service_role TO CURRENT_USER;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));
-- PostgREST v12 sets request.jwt.claims (JSON); accept the legacy claim too. A harness shim, as in run-postgrest-contract-proof.sh.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true)::json->>'sub', ''))::uuid
$fn$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT COALESCE(nullif(current_setting('request.jwt.claims', true)::json->>'role', ''), 'anon')
$fn$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated;
SQL
for f in 20260605080000_user_issue_reports.sql 20260605120000_user_issue_reports_optional_user.sql \
         20260607023000_grant_issue_report_insert.sql 20260710000000_user_issue_reports_category_slugs.sql \
         20260721130000_report_session_ownership_guard.sql 20260903140000_feedback_kind_severity_contract.sql \
         20260904150000_share_feedback_redesign.sql; do
  $PSQL -f "$M/$f" >/dev/null
done
$PSQL -c "NOTIFY pgrst, 'reload schema';" >/dev/null
echo "bootstrap: authenticated INSERT=$($PSQL -c "SELECT has_table_privilege('authenticated','public.user_issue_reports','INSERT')") key SELECT=$($PSQL -c "SELECT has_column_privilege('authenticated','public.user_issue_reports','idempotency_key','SELECT')") anon INSERT=$($PSQL -c "SELECT has_table_privilege('anon','public.user_issue_reports','INSERT')")"
