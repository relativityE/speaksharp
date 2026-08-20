#!/usr/bin/env bash
# #1314 — MACHINE-ENFORCED postflight gate.
#
# The readback SQL is a SELECT: it prints state and exits 0. It is a DIAGNOSTIC, not a gate. This script asserts
# each expectation and EXITS NONZERO on any deviation, so a partial or wrong apply cannot be mistaken for a
# completed one.
#
# CONNECTION: uses DB_URL if set (the CI/db-push path passes it), else the ambient PG* env. An earlier version
# hard-coded bare `psql` and silently ignored DB_URL, so it could check a DIFFERENT database than the one the
# migration was applied to — proving nothing. DB_URL is now honoured explicitly.
#
# Usage:  DB_URL=postgres://… postflight-gate-1314.sh before|after
#   before  exact state expected BEFORE apply (also the expected state after a successful ROLLBACK)
#   after   exact state expected after a CLEAN apply
set -euo pipefail

MODE="${1:-}"
[ "$MODE" = "before" ] || [ "$MODE" = "after" ] || { echo "usage: DB_URL=… $0 before|after" >&2; exit 2; }

# Honour DB_URL when provided; fall back to ambient PG* env otherwise.
if [ -n "${DB_URL:-}" ]; then PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt)
else PSQL=(psql -v ON_ERROR_STOP=1 -qAt); fi
q() { "${PSQL[@]}" -c "$1"; }

fails=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then printf '  OK   %-40s %s\n' "$1" "$3"
  else printf '  FAIL %-40s expected=%s actual=%s\n' "$1" "$2" "$3"; fails=$((fails+1)); fi
}

# EXACT signature of the atomic RPC (not just "a function named complete_session_v2 exists").
V2_SIG='complete_session_v2(uuid, text, integer, text, jsonb, integer, double precision, double precision, jsonb, jsonb, text)'
V2_PRESENT=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND (p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')') = '$V2_SIG';")

CHARS_SIG='max_persisted_transcript_chars()'
BYTES_SIG='max_persisted_transcript_bytes()'
CHARS_PRESENT=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')') = '$CHARS_SIG';")
BYTES_PRESENT=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')') = '$BYTES_SIG';")

# Pre-existing overloads, which must NEVER change — asserted by their EXACT signatures.
LEGACY_SIG='complete_session(uuid, text, text, integer, text)'
STAGEA_SIG='complete_session(uuid, text, integer, text, jsonb, integer, double precision, double precision, jsonb, jsonb)'
LEGACY=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')') = '$LEGACY_SIG';")
STAGEA=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')') = '$STAGEA_SIG';")
# ...and NO extra complete_session overload beyond those exactly two.
CS_TOTAL=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='complete_session';")

# ANY public execute on the created functions is a hard fail in BOTH modes.
PUBEXEC=$(q "SELECT COALESCE(bool_or(has_function_privilege('public', p.oid, 'EXECUTE')), false)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
  ('complete_session_v2','max_persisted_transcript_chars','max_persisted_transcript_bytes');")

# Server-owned trigger untouched and enabled in both modes.
TRG=$(q "SELECT count(*) FROM pg_trigger t WHERE t.tgrelid='public.sessions'::regclass
  AND NOT t.tgisinternal AND t.tgname='trg_sessions_set_transcript_state' AND t.tgenabled='O';")

echo "== postflight gate: expecting the '$MODE' state${DB_URL:+ (via DB_URL)} =="
check "pre-existing legacy overload"          "1"  "$LEGACY"
check "pre-existing stage-a overload"         "1"  "$STAGEA"
check "no extra complete_session overload"    "2"  "$CS_TOTAL"
check "transcript_state trigger enabled"      "1"  "$TRG"
check "PUBLIC execute on created fns"         "f"  "$PUBEXEC"

if [ "$MODE" = "after" ]; then
  check "complete_session_v2 (exact sig)"     "1"  "$V2_PRESENT"
  check "max_persisted_transcript_chars sig"  "1"  "$CHARS_PRESENT"
  check "max_persisted_transcript_bytes sig"  "1"  "$BYTES_PRESENT"
  check "v2 -> coordinator edge" "1" "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND p.proname='complete_session_v2'
      AND pg_get_functiondef(p.oid) ILIKE '%converge_transcript_retention%';")"
  check "transcript char limit" "50000"  "$(q "SELECT public.max_persisted_transcript_chars();")"
  check "transcript byte limit" "200000" "$(q "SELECT public.max_persisted_transcript_bytes();")"

  # EXACT grantee set per function: not "the required grant exists" but "the grants are EXACTLY these".
  # An extra unauthorized grantee (e.g. anon) must FAIL, which a per-grant existence check would miss.
  for fn in complete_session_v2 max_persisted_transcript_chars max_persisted_transcript_bytes; do
    GRANTEES=$(q "SELECT COALESCE(string_agg(DISTINCT rolname, ',' ORDER BY rolname), '(none)')
                  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  CROSS JOIN LATERAL aclexplode(p.proacl) a
                  JOIN pg_roles r ON r.oid=a.grantee
                  WHERE n.nspname='public' AND p.proname='$fn' AND a.privilege_type='EXECUTE';")
    # postgres is the owner's implicit grant; the intended explicit set is authenticated + service_role.
    check "EXACT grantees $fn" "authenticated,postgres,service_role" "$GRANTEES"
  done
else
  check "complete_session_v2 absent"          "0"  "$V2_PRESENT"
  check "max_persisted_transcript_chars absent" "0" "$CHARS_PRESENT"
  check "max_persisted_transcript_bytes absent" "0" "$BYTES_PRESENT"
fi

echo
if [ "$fails" -ne 0 ]; then
  echo "GATE FAILED: $fails expectation(s) not met — this is NOT the '$MODE' state."
  exit 1
fi
echo "GATE PASSED: state matches '$MODE' exactly."
