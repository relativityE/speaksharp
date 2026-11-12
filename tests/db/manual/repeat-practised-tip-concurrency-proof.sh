#!/usr/bin/env bash
# Outcome 4 D2 — one-command, independently reproducible concurrency proof for the practised-tip migration.
#
#   tests/db/manual/repeat-practised-tip-concurrency-proof.sh
#
# What it does, with no other setup:
#   1. Creates a THROWAWAY PostgreSQL cluster in a new temp directory (initdb, Unix socket only, no TCP listener),
#      using the PostgreSQL binaries on this machine (PG_BIN, else `pg_config --bindir`, else the newest
#      /usr/lib/postgresql/*/bin). It never connects to any other server.
#   2. Runs tests/db/manual/repeat-practised-tip-concurrency.sh against the migration as committed.
#      EXPECTED: all 9 scenarios PASS.
#   3. Builds a control copy of the migration in the temp directory with the per-owner advisory lock removed
#      (exactly 3 call sites), and runs the same scenarios against it.
#      EXPECTED: the first 5 checks (scenarios 1-4) PASS and the 4 race checks (scenarios 6-9) FAIL.
#   4. Stops the cluster and deletes the temp directory, whatever happened.
# Exit 0 only when BOTH expectations hold. Output is content-free (synthetic ids and one synthetic tip).
#
# Requirements: bash, initdb, pg_ctl, psql, sed, sha256sum. If run as root, the cluster runs as the `postgres` OS user.
# Captured output from the author's run: tests/db/manual/repeat-practised-tip-concurrency-proof.output.txt
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MIGRATION="$ROOT/backend/supabase/migrations/20261112010000_repeat_practised_tip.sql"
SCENARIOS="$ROOT/tests/db/manual/repeat-practised-tip-concurrency.sh"

if [[ -z "${PG_BIN:-}" ]]; then
  if command -v pg_config >/dev/null 2>&1 && [[ -x "$(pg_config --bindir)/initdb" ]]; then PG_BIN="$(pg_config --bindir)";
  else PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"; fi
fi
[[ -x "$PG_BIN/initdb" && -x "$PG_BIN/pg_ctl" && -x "$PG_BIN/psql" ]] || { echo "PostgreSQL binaries not found; set PG_BIN" >&2; exit 2; }
export PATH="$PG_BIN:$PATH"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/tip-conc-proof-XXXXXX")"
RUN=()
if [[ "$(id -u)" == 0 ]]; then chown postgres "$WORK"; chmod 755 "$WORK"; RUN=(runuser -u postgres --); fi
PORT=$(( 50000 + RANDOM % 10000 ))
cleanup() {
  "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -w -l "$WORK/server.log" \
  -o "-k $WORK -p $PORT -c listen_addresses=''" start >/dev/null
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres

sed 's/^    PERFORM public._prec_att_lock_owner(NEW.user_id);$/    -- (control: owner lock removed)/' "$MIGRATION" > "$WORK/control-no-owner-lock.sql"
removed=$(grep -c 'control: owner lock removed' "$WORK/control-no-owner-lock.sql" || true)
[[ "$removed" == 3 ]] || { echo "control build expected 3 lock call sites, found $removed" >&2; exit 2; }
chmod a+r "$WORK/control-no-owner-lock.sql"

echo "PostgreSQL: $(psql -X -Atc 'SHOW server_version' -d postgres)  (throwaway cluster, Unix socket only)"
echo "Migration:  $(basename "$MIGRATION")  sha256 $(sha256sum "$MIGRATION" | cut -d' ' -f1)"
echo

echo "== Run 1: migration as committed (expect 9 PASS)"
set +e; out1="$(bash "$SCENARIOS" 2>&1)"; rc1=$?; set -e
grep -E '^(PASS|FAIL|[0-9]\.)' <<<"$out1"
pass1=$(grep -c '^PASS' <<<"$out1" || true); fail1=$(grep -c '^FAIL' <<<"$out1" || true)
echo

echo "== Run 2: control with the per-owner lock removed (expect the first 5 checks PASS, race scenarios 6-9 FAIL)"
set +e; out2="$(MIGRATION="$WORK/control-no-owner-lock.sql" bash "$SCENARIOS" 2>&1)"; rc2=$?; set -e
grep -E '^(PASS|FAIL|[0-9]\.)' <<<"$out2"
pass2=$(grep -c '^PASS' <<<"$out2" || true)
# The four race scenarios are the last four checks; each must FAIL under the control.
race_fails=$(grep -E '^(PASS|FAIL)' <<<"$out2" | tail -4 | grep -c '^FAIL' || true)
echo

ok=1
if [[ $rc1 -eq 0 && $pass1 -eq 9 && $fail1 -eq 0 ]]; then echo "RESULT run 1: 9/9 PASS"; else echo "RESULT run 1: UNEXPECTED (exit $rc1, $pass1 pass, $fail1 fail)"; ok=0; fi
if [[ $rc2 -ne 0 && $pass2 -eq 5 && $race_fails -eq 4 ]]; then echo "RESULT run 2: control fails the 4 race scenarios, as expected"; else echo "RESULT run 2: UNEXPECTED (exit $rc2, $pass2 pass, $race_fails of 4 race scenarios failed)"; ok=0; fi
[[ $ok -eq 1 ]] && echo "PROOF: OK" || echo "PROOF: NOT OK"
[[ $ok -eq 1 ]]
