#!/usr/bin/env bash
# #1314 — poisoned-migration proof through the PINNED Supabase CLI `db push --db-url`, against a disposable
# Postgres. This is the requirement direct `psql` could not meet: it proves what the ACTUAL apply path does with
# a mid-file failure, not merely that the hazard exists in raw SQL.
#
# Expects: `supabase` on PATH at the pinned version (the workflow installs it), and DB_URL pointing at a
# throwaway Postgres. Exits nonzero on any failed assertion.
set -euo pipefail

: "${DB_URL:?set DB_URL to a disposable postgres URL}"
PSQL="psql $DB_URL -v ON_ERROR_STOP=1 -qAt"
M=backend/supabase/migrations
GOOD="$M/20260819120000_complete_session_v2_atomic_retention_1314.sql"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== pinned CLI version =="
supabase --version

# A disposable migrations dir the CLI treats as the project's history. We copy the REAL prerequisite migrations
# plus the target, so db push replays the exact chain.
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/supabase/migrations"
# Minimal supabase config so the CLI runs; db push --db-url does not need a linked project.
cat > "$WORK/supabase/config.toml" <<TOML
project_id = "disposable-1314"
TOML

seed_history() {
  # Point db push at a fresh schema and let it replay the whole chain from empty.
  $PSQL -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
            DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS supabase_migrations CASCADE;" >/dev/null
  rm -f "$WORK"/supabase/migrations/*.sql
  # Bundle the bootstrap + real prerequisites into ONE leading migration so the target applies against a realistic
  # schema, then the target itself as the migration under test.
  # db push speaks the Postgres wire protocol, not psql, so strip psql meta-commands (leading backslash) from
  # the bundle — otherwise `\set ON_ERROR_STOP on` in a test-support file is a 42601 syntax error and the
  # migration fails BEFORE the injection point (the marker check catches exactly that).
  cat tests/db/transcript-retention-converge-bootstrap.sql \
      "$M/20260801000000_sessions_transcript_state.sql" \
      "$M/20260803000000_transcript_retention_newest_two.sql" \
      "$M/20260804000000_transcript_retention_converge_on_save.sql" \
      tests/db/atomic-completion-concurrency-realpg.sql \
      "$M/20260816223606_metrics_only_additive_1306.sql" \
      | grep -vE '^[[:space:]]*\\' \
      > "$WORK/supabase/migrations/20260101000000_prereq_bundle.sql"
}

created() {
  $PSQL -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname IN
            ('complete_session_v2','max_persisted_transcript_chars','max_persisted_transcript_bytes');"
}
history_has() { # $1 = version prefix
  $PSQL -c "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '$1%';" 2>/dev/null || echo 0
}

echo "== CASE A: POISONED target fails mid-file through db push --db-url =="
seed_history
# Inject, immediately BEFORE the ACLs, (a) a unique marker proving we reached the post-create point, then
# (b) a guaranteed failure. The marker is what distinguishes "the migration ran and failed where we injected"
# from "the CLI died before running the migration at all" (Consultant requirement).
MARKER="POISON_MARKER_1314_$$_REACHED_POST_CREATE"
awk -v m="$MARKER" '/^REVOKE EXECUTE ON FUNCTION public.complete_session_v2/ && !d {
       print "DO $inj$ BEGIN RAISE NOTICE '"'"'" m "'"'"'; END $inj$;";
       print "SELECT 1/0;  -- INJECTED FAILURE"; d=1 } {print}' \
  "$GOOD" > "$WORK/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql"
grep -q "$MARKER" "$WORK/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql" \
  || fail "marker injection missing — proof would be vacuous"
grep -q "INJECTED FAILURE" "$WORK/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql" \
  || fail "failure injection missing — proof would be vacuous"

set +e
( cd "$WORK" && supabase db push --db-url "$DB_URL" --yes ) > /tmp/pushA.log 2>&1
RC=$?
set -e
echo "   db push rc=$RC"
sed -n '1,40p' /tmp/pushA.log | sed 's/^/     | /'
[ "$RC" -ne 0 ] || fail "poisoned db push exited 0 — it must fail"

# PROVE the migration reached the post-create failure point (Consultant): the marker, the target migration
# name, and the injected division-by-zero must all appear in the pinned-CLI log. Without this, "nonzero exit +
# zero functions" could just mean the CLI failed before ever running the migration.
grep -q "$MARKER" /tmp/pushA.log \
  || fail "the post-create marker is absent from the db push log — the migration may have failed BEFORE the injection point"
grep -q "20260819120000_complete_session_v2_atomic_retention_1314" /tmp/pushA.log \
  || fail "the target migration name is absent from the db push log — db push may not have run it"
grep -qiE "division by zero" /tmp/pushA.log \
  || fail "the injected error is absent from the db push log — the failure came from somewhere else"
echo "   reach proven: marker + target migration name + injected error all present in the pinned-CLI log"

N=$(created); echo "   created objects after the failure: $N / 3"
H=$(history_has 20260819120000); echo "   migration-history rows for the target: $H"

# The three required outcomes.
[ "$N" -eq 0 ] || fail "REQUIREMENT: expected 0 created functions after a failed push, got $N (partial apply)"
[ "$H" -eq 0 ] || fail "REQUIREMENT: the failed migration must NOT be recorded in history, found $H row(s)"
echo "   -> nonzero exit, zero functions, no history entry."

echo "== readback UNCHANGED vs the pre-apply state =="
DB_URL="$DB_URL" bash scripts/postflight-gate-1314.sh before  # asserts the 'before' state exactly; nonzero on any drift

echo "== CASE B: the CLEAN target applies and the postflight gate passes =="
seed_history
cp "$GOOD" "$WORK/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql"
( cd "$WORK" && supabase db push --db-url "$DB_URL" --yes ) > /tmp/pushB.log 2>&1 || { cat /tmp/pushB.log; fail "clean push failed"; }
HB=$(history_has 20260819120000)
echo "   migration-history rows for the target after clean push: $HB"
[ "$HB" -eq 1 ] || fail "clean push must record EXACTLY ONE migration-history row for the target, found $HB"
DB_URL="$DB_URL" bash scripts/postflight-gate-1314.sh after

echo
echo "PASS: through the pinned CLI, a poisoned db push fails closed (0 functions, no history), the readback is"
echo "      unchanged, and a clean push satisfies the exact postflight gate."
