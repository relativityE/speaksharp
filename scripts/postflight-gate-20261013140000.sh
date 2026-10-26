#!/usr/bin/env bash
# 20261013140000 — MACHINE-ENFORCED pre/postflight gate for the typed-empty-array follow-up to the #1258 P0 retention-expiry
# fix (20261013140000_retention_expiry_typed_empty_array_1258.sql).
#
# FUNCTION IDENTITY, not migration-history identity: md5(pg_get_functiondef(...)) of what Production executes, compared
# with the reviewed digests derived on PostgreSQL 17 and pinned by tests/db/retention-expiry-no-superuser-1258.integration.test.ts.
#
#   before: Production must hold exactly what 20261013120000 deployed (run 38428832342): expiry e966ca4e…, derivation
#           trigger 400700738…, the grants table present, and the expiry owned by the applying role.
#   after:  the expiry is the typed body; the trigger is unchanged; SECURITY DEFINER, pinned search_path, EXECUTE for
#           service_role only; the grants table still owned by the expiry's owner, row-level-secured, closed to every
#           client role and empty. The lint return-to-baseline is the workflow's own lint-delta step.
#
# READ-ONLY: catalog SELECTs plus a row count of the transient grants table. Never calls a function, reads no session.
# Prints digests, booleans and counts only. CONNECTION: DB_URL if set, else the ambient PG* env.
#
# Usage:  DB_URL=postgres://… postflight-gate-20261013140000.sh before|after
set -euo pipefail

MODE="${1:-}"
[ "$MODE" = "before" ] || [ "$MODE" = "after" ] || { echo "usage: DB_URL=… $0 before|after" >&2; exit 2; }

# Reviewed definition digests (PostgreSQL 17; recomputed by the integration test, which fails if any drifts).
EXPIRE_BEFORE_MD5=e966ca4e86e1be90e95b708baa2da836   # 20261013120000 expiry, as deployed by run 38428832342
TRIGGER_BEFORE_MD5=400700738ca78de10d259b550499b5ac  # 20261013120000 derivation trigger (unchanged by this migration)
EXPIRE_AFTER_MD5=0970783e8e75686029b1462069168dcc    # 20261013140000 expiry with typed empty-array literals
TRIGGER_AFTER_MD5=400700738ca78de10d259b550499b5ac   # unchanged

if [ -n "${DB_URL:-}" ]; then PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt)
else PSQL=(psql -v ON_ERROR_STOP=1 -qAt); fi
q() { "${PSQL[@]}" -c "$1"; }

fails=0
check() {
  if [ "$2" = "$3" ]; then printf '  OK   %-62s %s\n' "$1" "$3"
  else printf '  FAIL %-62s expected=%s actual=%s\n' "$1" "$2" "$3"; fails=$((fails+1)); fi
}

EXPIRE="'public.expire_transcripts_newest_one(uuid, integer)'::regprocedure"
TRIGGER="'public.sessions_set_transcript_state()'::regprocedure"
present="$(q "SELECT (to_regprocedure('public.expire_transcripts_newest_one(uuid, integer)') IS NOT NULL AND to_regprocedure('public.sessions_set_transcript_state()') IS NOT NULL)::text")"
check "both routines exist" "true" "$present"
[ "$present" = "true" ] || { echo "RESULT: FAIL ($MODE) — routine absent"; exit 1; }

expire_digest="$(q "SELECT md5(pg_get_functiondef($EXPIRE))")"
trigger_digest="$(q "SELECT md5(pg_get_functiondef($TRIGGER))")"
grants_present="$(q "SELECT (to_regclass('public.transcript_retention_expiry_grants') IS NOT NULL)::text")"
if [ "$MODE" = "before" ]; then
  check "expiry is the deployed 20261013120000 body" "$EXPIRE_BEFORE_MD5" "$expire_digest"
  check "derivation trigger is the deployed 20261013120000 body" "$TRIGGER_BEFORE_MD5" "$trigger_digest"
  check "grants table present" "true" "$grants_present"
  # CREATE OR REPLACE keeps the owner; the expiry must still be owned by the applying role, as the grants table design assumes.
  check "expiry owned by the applying role" "true" "$(q "SELECT (pg_get_userbyid(proowner) = current_user)::text FROM pg_proc WHERE oid = $EXPIRE")"
else
  check "expiry is the reviewed typed body (20261013140000)" "$EXPIRE_AFTER_MD5" "$expire_digest"
  check "derivation trigger unchanged (20261013120000)" "$TRIGGER_AFTER_MD5" "$trigger_digest"
  check "expiry SECURITY DEFINER" "true" "$(q "SELECT prosecdef::text FROM pg_proc WHERE oid = $EXPIRE")"
  check "expiry search_path pinned" "{\"search_path=public, pg_temp\"}" "$(q "SELECT coalesce(proconfig::text,'-') FROM pg_proc WHERE oid = $EXPIRE")"
  check "service_role may EXECUTE the expiry" "true" "$(q "SELECT has_function_privilege('service_role', $EXPIRE, 'EXECUTE')::text")"
  check "authenticated may not EXECUTE the expiry" "false" "$(q "SELECT has_function_privilege('authenticated', $EXPIRE, 'EXECUTE')::text")"
  check "anon may not EXECUTE the expiry" "false" "$(q "SELECT has_function_privilege('anon', $EXPIRE, 'EXECUTE')::text")"
  check "no PUBLIC EXECUTE grant on the expiry" "0" "$(q "SELECT count(*)::text FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $EXPIRE AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'")"
  check "derivation trigger enabled on sessions" "O" "$(q "SELECT coalesce(max(t.tgenabled::text),'-') FROM pg_trigger t WHERE t.tgrelid = 'public.sessions'::regclass AND t.tgname = 'trg_sessions_set_transcript_state' AND t.tgfoid = $TRIGGER")"
  check "grants table present" "true" "$grants_present"
  if [ "$grants_present" = "true" ]; then
  check "grants table owned by the expiry's owner" "true" "$(q "SELECT (c.relowner = p.proowner)::text FROM pg_class c, pg_proc p WHERE c.oid = 'public.transcript_retention_expiry_grants'::regclass AND p.oid = $EXPIRE")"
  check "grants table row-level secured" "true" "$(q "SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.transcript_retention_expiry_grants'::regclass")"
  check "no client role or PUBLIC holds any privilege on the grants table" "0" "$(q "SELECT count(*)::text FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.transcript_retention_expiry_grants'::regclass AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')))")"
  check "grants table empty (grants never outlive their statement)" "0" "$(q "SELECT count(*)::text FROM public.transcript_retention_expiry_grants")"
  fi
fi

if [ "$fails" -ne 0 ]; then echo "RESULT: FAIL ($MODE) — $fails check(s) failed"; exit 1; fi
echo "RESULT: PASS ($MODE)"
