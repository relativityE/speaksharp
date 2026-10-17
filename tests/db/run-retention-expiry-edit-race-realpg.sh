#!/usr/bin/env bash
# #1258 P0 (PM review 6148753844) — ACTUAL PostgreSQL proof that the retention expiry never nulls a row edited after it was
# selected. PGlite is single-connection and cannot interleave two transactions, so this starts a throwaway cluster,
# applies the same verbatim chain and Production-like ownership as
# tests/db/retention-expiry-no-superuser-1258.integration.test.ts, and drives two sessions DETERMINISTICALLY:
#
#   editor: BEGIN; edits an older completed take's transcript (holds its row lock); waits until the expiry is provably
#           blocked on that lock (pg_stat_activity wait_event_type = 'Lock'); COMMIT.
#   expiry: as the NOSUPERUSER function owner, expire_transcripts_newest_one(user). Its batch snapshot holds the OLD text;
#           its UPDATE blocks on the row, then PostgreSQL re-checks the row's NEWER version.
#
# Expected (the fix): the edited words survive, nothing becomes NULL + `not_captured`, no tombstone contradicts its row,
# no grant remains, and the next run expires the edited row with its exact edited text. Prints PASS/FAIL per check and
# exits non-zero on any FAIL.
#
# Usage:
#   tests/db/run-retention-expiry-edit-race-realpg.sh
#       Self-contained: starts its own throwaway cluster (needs initdb/pg_ctl/psql on PATH; nothing leaves /tmp).
#   RACE_PG_EXTERNAL=1 tests/db/run-retention-expiry-edit-race-realpg.sh
#       Against an EXISTING server reached through the ambient PG* variables (CI's postgres service; needs a superuser
#       login and psql only). Creates a fresh, uniquely named database and owner role, and drops both on exit.
#   MIGRATION_FILE=<path> overrides the fix under test (to show RED on an earlier version).
set -euo pipefail
export LC_ALL=${LC_ALL:-en_US.UTF-8} LANG=${LANG:-en_US.UTF-8}
cd "$(dirname "$0")/../.."
M=backend/supabase/migrations
FIX=${MIGRATION_FILE:-$M/20261013120000_retention_expiry_without_superuser_1258.sql}
U=11111111-1111-4111-8111-111111111111
RUN=$$_$(date +%s)
DB=race1258_$RUN
OWNER=ss_function_owner_$RUN
WORK=$(mktemp -d /tmp/pgrace1258.XXXXXX)
if [ "${RACE_PG_EXTERNAL:-0}" = "1" ]; then
  ADMIN_DB=${PGDATABASE:-postgres}
  cleanup() {
    psql -d "$ADMIN_DB" -AtqX -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || true
    psql -d "$ADMIN_DB" -AtqX -c "DROP ROLE IF EXISTS $OWNER" >/dev/null 2>&1 || true
    rm -rf "$WORK"
  }
else
  PORT=${PORT:-55814}
  initdb -D "$WORK/data" -A trust -U postgres >/dev/null
  pg_ctl -D "$WORK/data" -o "-p $PORT -k /tmp" -l "$WORK/log" -w start >/dev/null
  export PGHOST=/tmp PGPORT=$PORT PGUSER=postgres
  unset PGPASSWORD PGDATABASE
  ADMIN_DB=postgres
  cleanup() { pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
fi
trap cleanup EXIT
FAILS=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
q() { psql -d "$DB" -v ON_ERROR_STOP=1 -AtqX -c "$1"; }
qf() { psql -d "$DB" -v ON_ERROR_STOP=1 -AtqX -f "$1" >/dev/null 2>"$WORK/err" || { echo "FAIL applying $1: $(tail -3 "$WORK/err")"; exit 1; }; }

# The suite's own BOOTSTRAP and PRODUCTION_OWNERSHIP SQL, so both proofs run the identical schema and ownership.
node -e '
const t = require("fs").readFileSync("tests/db/retention-expiry-no-superuser-1258.integration.test.ts", "utf8");
const grab = (name) => { const s = t.indexOf(`const ${name} = \``) + name.length + 10; return t.slice(s, t.indexOf("`;", s)); };
const sub = (x) => x.replaceAll("${U}", process.argv[1]).replaceAll("${OWNER}", process.argv[2]);
require("fs").writeFileSync(process.argv[3] + "/boot.sql", sub(grab("BOOTSTRAP")));
require("fs").writeFileSync(process.argv[3] + "/own.sql", sub(grab("PRODUCTION_OWNERSHIP")));
' "$U" "$OWNER" "$WORK"

psql -d "$ADMIN_DB" -v ON_ERROR_STOP=1 -AtqX -c "CREATE DATABASE $DB" >/dev/null
echo "     server: $(q "SELECT current_setting('server_version')"); database $DB"
qf "$WORK/boot.sql"
for f in 20260801000000_sessions_transcript_state 20260803000000_transcript_retention_newest_two \
         20260731120000_session_progress_evaluations 20260804000000_transcript_retention_converge_on_save \
         20260805000000_transcript_retention_preflight 20260810120000_retention_purge_ai_suggestions \
         20260819120000_complete_session_v2_atomic_retention_1314 20260908120000_transcript_retention_newest_one \
         20260607040000_active_recording_lease 20260923120000_one_active_engine_per_account_1476 \
         20260926190000_session_product_marker_1258; do qf "$M/$f.sql"; done
qf "$FIX"
q "SELECT public.activate_transcript_retention_newest_one()" >/dev/null
qf "$WORK/own.sql"
[ "$(q "SELECT rolsuper FROM pg_roles WHERE rolname = '$OWNER'")" = "f" ] && pass "the function owner is not a superuser" || fail "owner is a superuser"

F=$(q "INSERT INTO public.sessions (user_id, created_at, transcript, total_words, duration, status) VALUES ('$U', '2026-10-01T10:00:00Z', 'the first take', 100, 600, 'completed') RETURNING id" | head -1)
q "INSERT INTO public.sessions (user_id, created_at, transcript, total_words, duration, status) VALUES ('$U', '2026-10-02T10:00:00Z', 'the second take', 100, 600, 'completed')" >/dev/null

# Editor: holds F's row lock and commits only once the expiry is waiting on it — i.e. after the expiry's batch snapshot.
psql -d "$DB" -v ON_ERROR_STOP=1 -AtqX >"$WORK/editor.out" 2>&1 <<SQL &
BEGIN;
UPDATE public.sessions SET transcript = 'the first take, edited' WHERE id = '$F';
DO \$\$ DECLARE n int := 0; BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();  -- pg_stat_activity is otherwise frozen at its first read in this transaction
    EXIT WHEN EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%expire_transcripts_newest_one(%');
    n := n + 1;
    IF n > 600 THEN RAISE EXCEPTION 'race-editor: the expiry never blocked on the edited row'; END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;
END \$\$;
COMMIT;
SQL
EDITOR=$!
for _ in $(seq 1 200); do
  [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND query LIKE '%race-editor:%' AND pid <> pg_backend_pid()")" = "1" ] && break
  sleep 0.05
done

RESULT=$(q "SET ROLE $OWNER; SELECT public.expire_transcripts_newest_one('$U', 500)" 2>&1 || true)
if wait "$EDITOR"; then pass "the expiry was blocked on the edited row and the edit committed under it"; else fail "editor: $(cat "$WORK/editor.out")"; fi
echo "     expiry result: $RESULT"

[ "$(q "SELECT transcript_state || '|' || coalesce(transcript, '<null>') FROM public.sessions WHERE id = '$F'")" = "available|the first take, edited" ] \
  && pass "the edited words survive, still available" \
  || fail "edited row is now: $(q "SELECT transcript_state || '|' || coalesce(transcript, '<null>') FROM public.sessions WHERE id = '$F'")"
[ "$(q "SELECT count(*) FROM public.sessions WHERE transcript IS NULL AND transcript_state = 'not_captured'")" = "0" ] \
  && pass "no row became NULL + not_captured" || fail "a row was nulled as not_captured"
[ "$(q "SELECT count(*) FROM public.transcript_retention_tombstones t JOIN public.sessions s ON s.id = t.session_id WHERE s.transcript IS NOT NULL AND t.transcript IS DISTINCT FROM s.transcript")" = "0" ] \
  && pass "no tombstone contradicts its row (later expiries are not blocked)" || fail "a tombstone now contradicts its row"
[ "$(q "SELECT count(*) FROM public.transcript_retention_expiry_grants")" = "0" ] && pass "no grant remains" || fail "grants remain"

NEXT=$(q "SET ROLE $OWNER; SELECT public.expire_transcripts_newest_one('$U', 500)->>'expired_count'" 2>&1 || true)
[ "$NEXT" = "1" ] && pass "the next run expires the edited row" || fail "next run: $NEXT"
[ "$(q "SELECT s.transcript_state || '|' || t.transcript FROM public.sessions s JOIN public.transcript_retention_tombstones t ON t.session_id = s.id WHERE s.id = '$F'")" = "expired|the first take, edited" ] \
  && pass "...and its tombstone holds the exact edited text" || fail "edited row not expired with its exact text"

[ "$FAILS" -eq 0 ] && { echo "RESULT: PASS"; exit 0; } || { echo "RESULT: FAIL ($FAILS)"; exit 1; }
