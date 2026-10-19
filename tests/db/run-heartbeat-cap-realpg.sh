#!/usr/bin/env bash
# #1593 (live RWT case 12) — ACTUAL PostgreSQL (not PGlite) proof that a heartbeat racing the device's save at the 600 s cap
# never loses the take.
#
# PGlite is single-connection, so it cannot show races. This starts a throwaway PostgreSQL cluster, applies the VERBATIM
# migration chain plus the DEPLOYED heartbeat_session (20260812041500), and drives TWO connections against one take at
# 570 s: one heartbeats the take to the cap while the other saves it, in both orders, each holding its transaction open so
# the other is observed BLOCKED on the row before it commits. Run once without and once with
# 20261019010000_heartbeat_session_cap_keeps_take_open_1593.sql. Every verdict is read back from the database and printed with
# a PASS/FAIL marker; the script exits non-zero on any FAIL. Content-free: synthetic UUIDs only.
#
# Usage: tests/db/run-heartbeat-cap-realpg.sh            (needs initdb/pg_ctl/psql on PATH; nothing leaves /tmp)
set -euo pipefail
# macOS PostgreSQL refuses to start ("postmaster became multithreaded") without a valid locale.
export LC_ALL=${LC_ALL:-en_US.UTF-8} LANG=${LANG:-en_US.UTF-8}
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")/../.."
M=backend/supabase/migrations
FIX=20261019010000_heartbeat_session_cap_keeps_take_open_1593
U=11111111-1111-4111-8111-111111111111
L1=aaaaaaaa-0000-4000-8000-000000000001
PORT=${PORT:-55593}
DATA=$(mktemp -d /tmp/pg1593.XXXXXX)
initdb -D "$DATA" -A trust -U postgres >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/log" -w start >/dev/null
trap 'pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT
FAILS=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
q() { psql -h /tmp -p "$PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -AtqX -c "$2"; }
qf() { psql -h /tmp -p "$PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -AtqX -f "$2" >/dev/null; }
as_user() { echo "SELECT set_config('request.jwt.claim.sub','$U',false);"; }

# The deployed heartbeat_session: exactly the 1290 migration's definition and its grants.
DEPLOYED="$DATA/deployed-heartbeat.sql"
awk '/^CREATE OR REPLACE FUNCTION public\.heartbeat_session\(/{p=1} p{print} p && /^\$\$;/{exit}' "$M/20260812041500_flawless_launch_runtime_convergence_1290.sql" > "$DEPLOYED"
grep -E 'ON FUNCTION public\.heartbeat_session\(UUID, INT\)' "$M/20260812041500_flawless_launch_runtime_convergence_1290.sql" >> "$DEPLOYED"

setup_db() {  # $1 db name, $2 with fix (1/0)
  q postgres "CREATE DATABASE $1" >/dev/null
  qf "$1" tests/db/one-active-engine-realpg-bootstrap.sql
  for f in 20260801000000_sessions_transcript_state 20260803000000_transcript_retention_newest_two 20260731120000_session_progress_evaluations \
           20260804000000_transcript_retention_converge_on_save 20260805000000_transcript_retention_preflight \
           20260819120000_complete_session_v2_atomic_retention_1314 20260908120000_transcript_retention_newest_one \
           20260607040000_active_recording_lease 20260923120000_one_active_engine_per_account_1476; do qf "$1" "$M/$f.sql"; done
  q "$1" "SELECT public.activate_transcript_retention_newest_one()" >/dev/null
  qf "$1" "$DEPLOYED"
  [ "$2" = 1 ] && qf "$1" "$M/$FIX.sql"
  return 0
}

# A live take under its own lease, heartbeated to 570 s — one heartbeat short of the cap.
take_at_570() {  # $1 db → prints the take id
  local id
  q "$1" "DELETE FROM public.sessions; DELETE FROM public.active_recording_lease; DELETE FROM public.usage_checkpoints;" >/dev/null
  id=$(q "$1" "$(as_user) SELECT public.acquire_recording_lease('$L1','device',false); SELECT public.create_session_and_update_usage('{\"title\":\"take\",\"duration\":0,\"total_words\":0,\"lease_id\":\"$L1\"}'::jsonb,'private');" \
    | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
  for _ in $(seq 19); do q "$1" "$(as_user) SELECT public.heartbeat_session('$id', 30);" >/dev/null; done
  echo "$id"
}
HEARTBEAT() { echo "SELECT public.heartbeat_session('$1', 30);"; }
SAVE() { echo "SELECT public.complete_session_v2('$1'::uuid, 'completed', 600, NULL, '{\"kind\":\"practice_focus\",\"focus\":\"pace\"}'::jsonb, 1300, 72.5, 130, '{\"um\":3}'::jsonb, NULL, 'the whole ten minute take');"; }

# Connection A runs $2 inside a transaction it holds open for 2 s; connection B runs $3 once A holds the row. While A sleeps,
# B must be waiting on A's lock (pg_blocking_pids) — the race is real, not sequential.
race() {  # $1 db, $2 first SQL, $3 second SQL, $4 label → sets B_OUT
  local db=$1 blocked
  ( psql -h /tmp -p "$PORT" -U postgres -d "$db" -AtqX -c "$(as_user) BEGIN; $2 SELECT pg_sleep(2); COMMIT;" >"$DATA/$4-a.out" 2>&1 || true ) &
  local a=$!
  sleep 0.5
  ( psql -h /tmp -p "$PORT" -U postgres -d "$db" -AtqX -c "$(as_user) $3" >"$DATA/$4-b.out" 2>&1 || true ) &
  local b=$!
  sleep 0.7
  blocked=$(q "$db" "SELECT count(*) FROM pg_stat_activity WHERE datname='$db' AND cardinality(pg_blocking_pids(pid)) > 0")
  wait $a $b
  [ "$blocked" -ge 1 ] && pass "[$4] the second connection was BLOCKED on the first's row lock (a real race)" || fail "[$4] no blocking observed ($blocked)"
  B_OUT=$(tail -1 "$DATA/$4-b.out")
}
row() { q "$1" "SELECT status || '|' || COALESCE(status_reason,'-') || '|' || duration || '|' || (transcript IS NOT NULL) FROM public.sessions WHERE id='$2'"; }
billed() { q "$1" "SELECT COALESCE(sum(incremental_seconds),0) FROM public.usage_checkpoints WHERE session_id='$2'"; }

# ---------- BEFORE: the deployed heartbeat (red baseline — the live case 12 failure) ----------
setup_db before 0
ID=$(take_at_570 before)
race before "$(HEARTBEAT "$ID")" "$(SAVE "$ID")" "before:heartbeat-then-save"
if grep -q 'idempotency conflict' "$DATA/before:heartbeat-then-save-b.out" && [ "$(row before "$ID")" = "completed|technical_duration_cap|600|false" ]; then
  pass "[before] RED BASELINE reproduced: the heartbeat closed the take at the cap and the device's save was refused (no transcript)"
else
  fail "[before] baseline not reproduced: row=$(row before "$ID") save=$B_OUT"
fi

# ---------- AFTER: 20261019010000 ----------
setup_db after 1
# Heartbeat holds the row as it reaches the cap; the save waits, then saves the take.
ID=$(take_at_570 after)
race after "$(HEARTBEAT "$ID")" "$(SAVE "$ID")" "after:heartbeat-then-save"
r=$(row after "$ID")
[ "$r" = "completed|-|600|true" ] && echo "$B_OUT" | grep -q '"success": true' \
  && pass "[after] heartbeat-then-save: the take reached the cap and the device's save completed it with its transcript ($r)" \
  || fail "[after] heartbeat-then-save: row=$r save=$B_OUT"
[ "$(billed after "$ID")" = 600 ] && pass "[after] heartbeat-then-save: billed exactly 600 s" || fail "[after] billed $(billed after "$ID")"

# The save holds the row; the late heartbeat waits, then finds the take saved and changes nothing.
ID=$(take_at_570 after)
race after "$(SAVE "$ID")" "$(HEARTBEAT "$ID")" "after:save-then-heartbeat"
r=$(row after "$ID")
[ "$r" = "completed|-|600|true" ] && echo "$B_OUT" | grep -q '"error": "session_not_active"' \
  && pass "[after] save-then-heartbeat: the late heartbeat was refused as not active and the saved take is unchanged ($r)" \
  || fail "[after] save-then-heartbeat: row=$r heartbeat=$B_OUT"
[ "$(billed after "$ID")" = 570 ] && pass "[after] save-then-heartbeat: the late heartbeat billed nothing (570 s)" || fail "[after] billed $(billed after "$ID")"

# At the cap, two devices' heartbeats racing each other never close the take or bill past 600.
ID=$(take_at_570 after)
race after "$(HEARTBEAT "$ID")" "$(HEARTBEAT "$ID")" "after:heartbeat-vs-heartbeat"
r=$(row after "$ID")
[ "$r" = "active|-|600|false" ] && [ "$(billed after "$ID")" = 600 ] \
  && pass "[after] heartbeat-vs-heartbeat: the take stays open at exactly 600 s, billed 600" \
  || fail "[after] heartbeat-vs-heartbeat: row=$r billed=$(billed after "$ID")"

echo "---"
if [ "$FAILS" -eq 0 ]; then echo "RESULT: PASS (all real-PostgreSQL controls)"; else echo "RESULT: FAIL ($FAILS)"; exit 1; fi
