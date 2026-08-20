#!/usr/bin/env bash
# #1314 — PERMANENT mutation harness for the postflight gate. A gate that cannot be shown to fail is not a gate.
#
# Applies the real migration chain, then for EACH important defect mutates the DB, runs the gate, and REQUIRES it
# to exit nonzero. Finally restores and requires it to pass. Runs in CI against the service container, so a gate
# that stops detecting any of these turns CI red — the mutation lives in the suite, not in a one-off check.
#
# Requires: DB_URL (honoured by the gate), psql. Exits nonzero if any mutation is NOT caught.
set -uo pipefail
: "${DB_URL:?set DB_URL}"
PSQL="psql $DB_URL -v ON_ERROR_STOP=1 -qAt"
M=backend/supabase/migrations
GATE="scripts/postflight-gate-1314.sh"
V2ARGS="uuid,text,integer,text,jsonb,integer,double precision,double precision,jsonb,jsonb,text"
fails=0

apply_clean() {
  $PSQL -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE;" >/dev/null
  for f in tests/db/transcript-retention-converge-bootstrap.sql \
           "$M/20260801000000_sessions_transcript_state.sql" \
           "$M/20260803000000_transcript_retention_newest_two.sql" \
           "$M/20260804000000_transcript_retention_converge_on_save.sql" \
           tests/db/atomic-completion-concurrency-realpg.sql \
           "$M/20260816223606_metrics_only_additive_1306.sql" \
           "$M/20260819120000_complete_session_v2_atomic_retention_1314.sql"; do
    $PSQL -f "$f" >/dev/null
  done
}

# expect_gate <mode> <expected-rc> <label>
expect_gate() {
  local mode="$1" want="$2" label="$3"
  set +e; DB_URL="$DB_URL" bash "$GATE" "$mode" >/dev/null 2>&1; local rc=$?; set -e
  if { [ "$want" = "fail" ] && [ "$rc" -ne 0 ]; } || { [ "$want" = "pass" ] && [ "$rc" -eq 0 ]; }; then
    printf '  CAUGHT  %-42s (gate rc=%s)\n' "$label" "$rc"
  else
    printf '  MISSED  %-42s (gate rc=%s, wanted %s)\n' "$label" "$rc" "$want"; fails=$((fails+1))
  fi
}

echo "== mutation harness for the #1314 postflight gate =="

# M0: clean apply must PASS (baseline; a gate that never passes is also useless)
apply_clean;                                                        expect_gate after pass "clean apply"

# M1: wrong function signature (drop v2, recreate with a different signature under the same name)
apply_clean
$PSQL -c "DROP FUNCTION public.complete_session_v2($V2ARGS);
          CREATE FUNCTION public.complete_session_v2(uuid) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';" >/dev/null
expect_gate after fail "wrong v2 signature"

# M2: missing helper
apply_clean
$PSQL -c "DROP FUNCTION public.max_persisted_transcript_bytes();" >/dev/null
expect_gate after fail "missing helper (bytes)"

# M3: PUBLIC execute
apply_clean
$PSQL -c "GRANT EXECUTE ON FUNCTION public.complete_session_v2($V2ARGS) TO PUBLIC;" >/dev/null
expect_gate after fail "PUBLIC execute granted"

# M4: extra unauthorized grantee
apply_clean
$PSQL -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='intruder') THEN CREATE ROLE intruder NOLOGIN; END IF; END \$\$;
          GRANT EXECUTE ON FUNCTION public.complete_session_v2($V2ARGS) TO intruder;" >/dev/null
expect_gate after fail "extra grantee (intruder)"

# M5: disabled trigger
apply_clean
$PSQL -c "ALTER TABLE public.sessions DISABLE TRIGGER trg_sessions_set_transcript_state;" >/dev/null
expect_gate after fail "disabled transcript_state trigger"

# M6: changed pre-existing overload (drop the legacy one)
apply_clean
$PSQL -c "DROP FUNCTION public.complete_session(uuid,text,text,integer,text);" >/dev/null
expect_gate after fail "legacy overload removed"

# M7: wrong database connection — point the gate at a DB WITHOUT the migration. This proves the gate honours
#     DB_URL (the exact bug that made the gate meaningless before), by catching the mismatch.
apply_clean
$PSQL -c "CREATE DATABASE gate_wrong_db;" >/dev/null 2>&1 || true
WRONG="${DB_URL%/*}/gate_wrong_db"
set +e; DB_URL="$WRONG" bash "$GATE" after >/dev/null 2>&1; rc=$?; set -e
if [ "$rc" -ne 0 ]; then printf '  CAUGHT  %-42s (gate rc=%s)\n' "wrong DB connection" "$rc"
else printf '  MISSED  %-42s (gate rc=%s)\n' "wrong DB connection" "$rc"; fails=$((fails+1)); fi

# M8: poison-not-reached is proven in run-db-push-partial-apply-proof.sh (marker absent -> proof fails). Asserted
#     there against the pinned CLI; noted here so the required-mutation list is completely accounted for.
echo "  NOTE    poison-not-reached is enforced in run-db-push-partial-apply-proof.sh (marker check)"

echo
if [ "$fails" -ne 0 ]; then echo "MUTATION HARNESS FAILED: $fails defect(s) NOT caught by the gate."; exit 1; fi
echo "MUTATION HARNESS PASSED: the gate catches every required defect and passes the clean state."
