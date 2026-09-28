#!/usr/bin/env bash
# 20260928120000 — MACHINE-ENFORCED pre/postflight gate for the Focus Points trial capability
# (20260928120000_focus_points_trial_capability.sql).
#
# FUNCTION IDENTITY, not migration-history identity. `supabase migration list` proves which migration files were
# recorded, not which body Production executes: an out-of-band `CREATE OR REPLACE` would be invisible to it. This gate
# reads md5(pg_get_functiondef(...)) — the definition the database actually holds — and compares it to the digest of the
# reviewed definition, derived on PostgreSQL 17 and pinned by tests/db/focus-points-trial-capability.integration.test.ts.
#
#   before: Production must still hold the reviewed LIVE definition (20260809000000). Anything else means an
#           unreviewed body is deployed; the run must stop rather than replace what nobody has reviewed.
#   after:  Production must hold exactly the reviewed trial-aware definition, SECURITY DEFINER, with the pinned
#           search_path, STABLE, and EXECUTE for `authenticated` only (never PUBLIC, anon or service_role).
#
# READ-ONLY: SELECTs over the catalog only. It never calls the function, reads no user_profiles row, and writes nothing.
# Prints digests and booleans only.
#
# CONNECTION: uses DB_URL if set, else the ambient PG* env — never a URI with an embedded credential.
#
# Usage:  DB_URL=postgres://… postflight-gate-20260928120000.sh before|after
set -euo pipefail

MODE="${1:-}"
[ "$MODE" = "before" ] || [ "$MODE" = "after" ] || { echo "usage: DB_URL=… $0 before|after" >&2; exit 2; }

# Reviewed definition digests (PostgreSQL 17; recomputed by the integration test, which fails if either drifts).
BEFORE_MD5=c33d2f1d8663060e7314523feb566ca1   # 20260809000000_focus_points_pro_capability.sql (grant OR pro)
AFTER_MD5=d175dc5e2cf61d7ff66affe793bfea75    # 20260928120000_focus_points_trial_capability.sql (grant OR pro OR active trial)

if [ -n "${DB_URL:-}" ]; then PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt)
else PSQL=(psql -v ON_ERROR_STOP=1 -qAt); fi
q() { "${PSQL[@]}" -c "$1"; }

fails=0
check() {
  if [ "$2" = "$3" ]; then printf '  OK   %-58s %s\n' "$1" "$3"
  else printf '  FAIL %-58s expected=%s actual=%s\n' "$1" "$2" "$3"; fails=$((fails+1)); fi
}

FN="'public.has_objective_capability()'::regprocedure"
present="$(q "SELECT (to_regprocedure('public.has_objective_capability()') IS NOT NULL)::text")"
check "has_objective_capability() exists" "true" "$present"
[ "$present" = "true" ] || { echo "RESULT: FAIL ($MODE) — function absent"; exit 1; }

digest="$(q "SELECT md5(pg_get_functiondef($FN))")"
if [ "$MODE" = "before" ]; then
  check "definition is the reviewed live body (20260809000000)" "$BEFORE_MD5" "$digest"
else
  check "definition is the reviewed trial-aware body (20260928120000)" "$AFTER_MD5" "$digest"
  check "SECURITY DEFINER" "true" "$(q "SELECT prosecdef::text FROM pg_proc WHERE oid = $FN")"
  check "search_path pinned" "{\"search_path=public, pg_temp\"}" "$(q "SELECT coalesce(proconfig::text,'-') FROM pg_proc WHERE oid = $FN")"
  check "STABLE (window read per call)" "s" "$(q "SELECT provolatile::text FROM pg_proc WHERE oid = $FN")"
  check "authenticated may EXECUTE" "true" "$(q "SELECT has_function_privilege('authenticated', $FN, 'EXECUTE')::text")"
  check "anon may not EXECUTE" "false" "$(q "SELECT has_function_privilege('anon', $FN, 'EXECUTE')::text")"
  check "service_role may not EXECUTE" "false" "$(q "SELECT has_function_privilege('service_role', $FN, 'EXECUTE')::text")"
  check "no PUBLIC EXECUTE grant" "0" "$(q "SELECT count(*)::text FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $FN AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'")"
fi

if [ "$fails" -ne 0 ]; then echo "RESULT: FAIL ($MODE) — $fails check(s) failed"; exit 1; fi
echo "RESULT: PASS ($MODE)"
