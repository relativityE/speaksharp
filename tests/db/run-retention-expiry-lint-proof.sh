#!/usr/bin/env bash
# #1258 P0 follow-up (PM 6150068041) — the Production lint finding, REPRODUCED and then ELIMINATED, with the same checker.
#
# Applying 20261013120000 failed the exact-apply lint gate (run 38428832342): `supabase db lint` — which runs the
# plpgsql_check extension over every plpgsql function — reported 42804 "target type is different type than source
# type" on public.expire_transcripts_newest_one, at `v_new_tombstones uuid[] := '{}'`. Showing that the function still
# runs proves nothing about that finding, so this applies the same verbatim chain as
# tests/db/retention-expiry-no-superuser-1258.integration.test.ts and asks plpgsql_check directly:
#
#   RED:   after 20261013120000, the expiry has a 42804 finding (the Production warning is reproduced here);
#   GREEN: after 20261013140000, it has no 42804 finding, and no finding it did not already have.
#
# Prints PASS/FAIL per check and every finding (level, sqlstate, message); exits non-zero on any FAIL.
#
# Usage:
#   tests/db/run-retention-expiry-lint-proof.sh
#       Self-contained: starts its own throwaway cluster. Needs initdb/pg_ctl/psql AND the plpgsql_check extension
#       installed for that PostgreSQL (CI installs postgresql-17-plpgsql-check from apt.postgresql.org).
#   LINT_PG_EXTERNAL=1 tests/db/run-retention-expiry-lint-proof.sh
#       Against an existing server via the ambient PG* variables (superuser login, plpgsql_check available). Creates a
#       fresh uniquely named database and drops it on exit.
set -euo pipefail
export LC_ALL=${LC_ALL:-C.UTF-8} LANG=${LANG:-C.UTF-8}
cd "$(dirname "$0")/../.."
M=backend/supabase/migrations
SHIPPED=$M/20261013120000_retention_expiry_without_superuser_1258.sql
FIX=${MIGRATION_FILE:-$M/20261013140000_retention_expiry_typed_empty_array_1258.sql}
U=11111111-1111-4111-8111-111111111111
RUN=$$_$(date +%s)
DB=lint1258_$RUN
OWNER=ss_function_owner_$RUN
WORK=$(mktemp -d /tmp/pglint1258.XXXXXX)
if [ "${LINT_PG_EXTERNAL:-0}" = "1" ]; then
  ADMIN_DB=${PGDATABASE:-postgres}
  cleanup() {
    psql -d "$ADMIN_DB" -AtqX -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || true
    psql -d "$ADMIN_DB" -AtqX -c "DROP ROLE IF EXISTS $OWNER" >/dev/null 2>&1 || true
    rm -rf "$WORK"
  }
else
  PORT=${PORT:-55815}
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
qf "$SHIPPED"
qf "$WORK/own.sql"
if ! q "CREATE EXTENSION IF NOT EXISTS plpgsql_check" >/dev/null 2>"$WORK/err"; then
  echo "FAIL plpgsql_check is not available on this server: $(tail -1 "$WORK/err")"; exit 1
fi
echo "     plpgsql_check $(q "SELECT extversion FROM pg_extension WHERE extname = 'plpgsql_check'")"

# Every finding plpgsql_check reports for the expiry, one per line: level|sqlstate|message.
findings() { q "SELECT level || '|' || coalesce(sqlstate, '-') || '|' || message FROM plpgsql_check_function_tb('public.expire_transcripts_newest_one(uuid, integer)'::regprocedure) ORDER BY 1"; }

BEFORE=$(findings)
echo "     findings after 20261013120000:"; printf '%s\n' "${BEFORE:-<none>}" | sed 's/^/       /'
echo "$BEFORE" | grep -q '|42804|' && pass "RED: the Production lint finding (42804 on the expiry) is reproduced" \
  || fail "the 42804 finding was NOT reproduced on 20261013120000"

qf "$FIX"
AFTER=$(findings)
echo "     findings after the fix:"; printf '%s\n' "${AFTER:-<none>}" | sed 's/^/       /'
echo "$AFTER" | grep -q '|42804|' && fail "the 42804 finding remains after the fix" || pass "GREEN: no 42804 finding after the fix"
NEW=$(comm -13 <(printf '%s\n' "$BEFORE" | sort -u) <(printf '%s\n' "$AFTER" | sort -u) | grep -v '^$' || true)
[ -z "$NEW" ] && pass "the fix adds no finding the expiry did not already have" || fail "new finding(s) after the fix: $NEW"

[ "$FAILS" -eq 0 ] && { echo "RESULT: PASS"; exit 0; } || { echo "RESULT: FAIL ($FAILS)"; exit 1; }
