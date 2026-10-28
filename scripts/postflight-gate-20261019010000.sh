#!/usr/bin/env bash
# 20261019010000 — MACHINE-ENFORCED pre/postflight gate for the #1593 heartbeat cap fix
# (20261019010000_heartbeat_session_cap_keeps_take_open_1593.sql).
#
# FUNCTION IDENTITY, not migration-history identity: md5(pg_get_functiondef(...)) of what Production executes, compared
# with the reviewed digests pinned by tests/db/heartbeat-cap-keeps-take-open-1593.integration.test.ts (which fails if
# either drifts).
#
#   before: Production must hold exactly the heartbeat_session that 20260812041500_flawless_launch_runtime_convergence_1290.sql
#           defines (the latest definition before this one); anything else is refused before the apply.
#   after:  heartbeat_session is the reviewed #1593 body; SECURITY DEFINER, pinned search_path; EXECUTE for
#           authenticated and service_role, never anon or PUBLIC (the grants the migration re-states).
#
# READ-ONLY: catalog SELECTs only. Never calls the function, reads no session. Prints digests and booleans only.
# CONNECTION: DB_URL if set, else the ambient PG* env.
#
# Usage:  DB_URL=postgres://… postflight-gate-20261019010000.sh before|after
set -euo pipefail

MODE="${1:-}"
[ "$MODE" = "before" ] || [ "$MODE" = "after" ] || { echo "usage: DB_URL=… $0 before|after" >&2; exit 2; }

# Reviewed definition digests (recomputed by the integration test, which fails if either drifts).
HEARTBEAT_BEFORE_MD5=e3226a816e3a03ac5251363b069e4cbe   # 20260812041500 heartbeat_session
HEARTBEAT_AFTER_MD5=1ba2759c5b17104f5501fe184646a211    # 20261019010000 heartbeat_session (take stays open at the cap)

if [ -n "${DB_URL:-}" ]; then PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt)
else PSQL=(psql -v ON_ERROR_STOP=1 -qAt); fi
q() { "${PSQL[@]}" -c "$1"; }

fails=0
check() {
  if [ "$2" = "$3" ]; then printf '  OK   %-62s %s\n' "$1" "$3"
  else printf '  FAIL %-62s expected=%s actual=%s\n' "$1" "$2" "$3"; fails=$((fails+1)); fi
}

SIG='public.heartbeat_session(uuid, integer)'
FN="'$SIG'::regprocedure"
present="$(q "SELECT (to_regprocedure('$SIG') IS NOT NULL)::text")"
check "heartbeat_session exists" "true" "$present"
[ "$present" = "true" ] || { echo "RESULT: FAIL ($MODE) — routine absent"; exit 1; }

digest="$(q "SELECT md5(pg_get_functiondef($FN))")"
if [ "$MODE" = "before" ]; then
  check "heartbeat_session is the deployed 20260812041500 body" "$HEARTBEAT_BEFORE_MD5" "$digest"
else
  check "heartbeat_session is the reviewed #1593 body (20261019010000)" "$HEARTBEAT_AFTER_MD5" "$digest"
  check "heartbeat_session SECURITY DEFINER" "true" "$(q "SELECT prosecdef::text FROM pg_proc WHERE oid = $FN")"
  check "heartbeat_session search_path pinned" "{\"search_path=public, pg_temp\"}" "$(q "SELECT coalesce(proconfig::text,'-') FROM pg_proc WHERE oid = $FN")"
  check "authenticated may EXECUTE heartbeat_session" "true" "$(q "SELECT has_function_privilege('authenticated', $FN, 'EXECUTE')::text")"
  check "service_role may EXECUTE heartbeat_session" "true" "$(q "SELECT has_function_privilege('service_role', $FN, 'EXECUTE')::text")"
  check "anon may not EXECUTE heartbeat_session" "false" "$(q "SELECT has_function_privilege('anon', $FN, 'EXECUTE')::text")"
  check "no PUBLIC EXECUTE grant on heartbeat_session" "0" "$(q "SELECT count(*)::text FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $FN AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'")"
fi

if [ "$fails" -ne 0 ]; then echo "RESULT: FAIL ($MODE) — $fails check(s) failed"; exit 1; fi
echo "RESULT: PASS ($MODE)"
