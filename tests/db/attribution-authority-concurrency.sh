#!/usr/bin/env bash
# #1161 — TRUE two-connection PostgreSQL proof for attest_session_engine_v1.
#
# A single-connection/PGlite simulation cannot prove concurrency, so this stands up a THROWAWAY local Postgres
# cluster (no Docker) and drives TWO INDEPENDENT connections that attest the SAME session:
#   Control 1 — concurrent identical attestation: connection A opens a txn, attests the session (acquiring the
#     session row's FOR UPDATE lock and writing the uncommitted authority row), and parks its txn open via a
#     DETERMINISTIC advisory-lock handshake (no timing sleep) while connection B races the SAME session. The
#     harness asserts (via pg_blocking_pids) that B is genuinely BLOCKED on A's uncommitted FOR UPDATE BEFORE A
#     commits, then that after A commits: exactly ONE authority row exists, BOTH connections return 'attrib_v1',
#     and the challenge is consumed exactly once (B short-circuits on the committed authority row — no 2nd write).
#   Control 2 — post-commit sequential replay stays idempotent: a third attest returns 'attrib_v1', still one row.
# Content-free: synthetic UUIDs only. Applies the #1161 migration VERBATIM over the test bootstrap.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../../backend/supabase/migrations/20260803010000_session_attribution_authority.sql"
BOOT="$HERE/attribution-authority-bootstrap.sql"
TMP="$(mktemp -d)"; PGDATA="$TMP/data"; SOCK="$TMP/sock"; mkdir -p "$SOCK"
export PGHOST="$SOCK" PGUSER=postgres PGDATABASE=postgres
export LC_ALL=C   # macOS/Homebrew PG17: avoids "postmaster became multithreaded during startup" fatal
cleanup(){ pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

initdb -D "$PGDATA" -A trust -U postgres >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
psql -v ON_ERROR_STOP=1 -qX -f "$BOOT" >/dev/null
psql -v ON_ERROR_STOP=1 -qX -f "$MIG" >/dev/null

U=11111111-1111-4111-8111-111111111111
q(){ psql -tAqX -v ON_ERROR_STOP=1 -c "SELECT set_config('request.jwt.claim.sub','$U',false)" -c "$1" | tail -n1; }
# service-role helper (issue/attest are service-role only)
qs(){ psql -tAqX -v ON_ERROR_STOP=1 -c "SET ROLE service_role" -c "$1" | tail -n1; }

# ── Seed: user + a verified-Private session + an issued challenge ──
psql -v ON_ERROR_STOP=1 -qX >/dev/null <<SQL
INSERT INTO auth.users(id) VALUES ('$U');
CREATE TABLE proof_result(who text primary key, val text);
GRANT ALL ON proof_result TO service_role;   -- A/B write their result under SET ROLE service_role
SQL
SESS=$(q "INSERT INTO public.sessions(user_id,engine,engine_version,model_name,device_type) VALUES ('$U','private-v2','v2','base','cpu') RETURNING id")
CH=$(qs "SELECT public.issue_attribution_challenge_v1('$SESS')")
EVID='{"provider":"transformers-js","model_id":"base","fallback_occurred":false,"cloud_used":false}'
echo "seed: session=$SESS challenge=$CH"

# ── Control 1: TWO connections attest the SAME session — DETERMINISTIC handshake (no timing sleep) ──
# A coordinator session holds advisory lock 888 (the commit gate). Connection A runs the attestation inside a
# txn, then signals via advisory lock 777 (observable the moment A is PAST the attest call, holding the session
# FOR UPDATE + the uncommitted authority row) and blocks acquiring 888 — holding its txn open. Only after B is
# PROVEN blocked by A (pg_blocking_pids non-empty) is the gate released so A commits. This proves true
# concurrency (B genuinely waited on A's uncommitted FOR UPDATE), which a fixed sleep could not guarantee.
FAIL=0
COORD_FIFO="$TMP/coord.fifo"; mkfifo "$COORD_FIFO"
psql -qAtX < "$COORD_FIFO" >/dev/null 2>&1 & COORD_PID=$!
exec 9>"$COORD_FIFO"
printf 'SELECT pg_advisory_lock(888);\n' >&9
for _ in $(seq 1 100); do [ "$(q "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=888 AND granted")" = "1" ] && break; sleep 0.05; done

( PGAPPNAME=connA psql -qAtX -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
SET ROLE service_role;
BEGIN;
INSERT INTO proof_result(who,val) VALUES ('A', public.attest_session_engine_v1('$SESS','$CH','$EVID'::jsonb));
SELECT pg_advisory_lock(777);
SELECT pg_advisory_lock(888);
COMMIT;
SQL
) & APID=$!
# Sync on observable A state: A holds 777 ⇒ it is past the attest call and parked on the gate.
A_PARKED=0
for _ in $(seq 1 200); do [ "$(q "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=777 AND granted")" = "1" ] && { A_PARKED=1; break; }; sleep 0.05; done
[ "$A_PARKED" = "1" ] || { echo "FAIL: connection A never reached the parked (attest-inserted) state"; FAIL=1; }

( PGAPPNAME=connB psql -qAtX -v ON_ERROR_STOP=1 -c "SET ROLE service_role" \
    -c "INSERT INTO proof_result(who,val) VALUES ('B', public.attest_session_engine_v1('$SESS','$CH','$EVID'::jsonb))" >/dev/null 2>&1 ) & BPID=$!
# Prove true concurrency: B must be BLOCKED BY another backend (A) BEFORE A commits.
B_BLOCKED=0
for _ in $(seq 1 200); do
  [ "$(q "SELECT count(*) FROM pg_stat_activity WHERE application_name='connB' AND cardinality(pg_blocking_pids(pid))>0")" = "1" ] && { B_BLOCKED=1; break; }
  sleep 0.05
done
echo "control1 handshake: A_parked=$A_PARKED B_blocked_by_A=$B_BLOCKED (both must be 1 before A commits)"
[ "$B_BLOCKED" = "1" ] || { echo "FAIL: B was not observed blocked on A's uncommitted attestation (no true-concurrency proof)"; FAIL=1; }

# Release the gate → A acquires 888, commits → B unblocks and resolves idempotently.
printf 'SELECT pg_advisory_unlock(888);\n' >&9
wait "$APID" "$BPID"
exec 9>&-; wait "$COORD_PID" 2>/dev/null || true

A_VAL=$(q "SELECT val FROM proof_result WHERE who='A'")
B_VAL=$(q "SELECT val FROM proof_result WHERE who='B'")
ROWS=$(q "SELECT count(*) FROM public.session_attribution_authority WHERE session_id='$SESS'")
CONSUMED=$(q "SELECT count(*) FROM public.session_attribution_challenge WHERE challenge_id='$CH' AND consumed_at IS NOT NULL")
echo "control1: A_val=$A_VAL B_val=$B_VAL authority_rows=$ROWS challenge_consumed=$CONSUMED"
[ "$A_VAL" = "attrib_v1" ] && [ "$B_VAL" = "attrib_v1" ] || { echo "FAIL: both connections must return attrib_v1"; FAIL=1; }
[ "$ROWS" = "1" ] || { echo "FAIL: expected exactly 1 authority row, got $ROWS"; FAIL=1; }
[ "$CONSUMED" = "1" ] || { echo "FAIL: challenge must be consumed exactly once, got $CONSUMED"; FAIL=1; }

# ── Control 2: post-commit sequential replay stays idempotent (same version, still one row) ──
R=$(qs "SELECT public.attest_session_engine_v1('$SESS','$CH','$EVID'::jsonb)")
ROWS2=$(q "SELECT count(*) FROM public.session_attribution_authority WHERE session_id='$SESS'")
echo "control2 sequential-replay: r=$R authority_rows=$ROWS2"
[ "$R" = "attrib_v1" ] && [ "$ROWS2" = "1" ] || { echo "FAIL: sequential replay not idempotent (r=$R rows=$ROWS2)"; FAIL=1; }

echo "postgres: $(postgres --version)"
if [ "$FAIL" = "0" ]; then echo "RESULT: PASS (true two-connection proof)"; else echo "RESULT: FAIL"; exit 1; fi
