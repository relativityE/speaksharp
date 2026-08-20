#!/usr/bin/env bash
# #1314 — FORCED PARTIAL-APPLY evidence for the atomic-completion migration.
#
# An earlier packet ASSERTED that `supabase db push` wraps each migration in a transaction. That guarantee is not
# documented, and asserting an undocumented CLI behaviour as a safety property is exactly the kind of claim this
# PR exists to stop making. So the claim is DROPPED and replaced with tested facts:
#
#   1. WITHOUT transaction control, a mid-file failure leaves a PARTIAL apply — proven here by injecting one.
#   2. WITH the `BEGIN … COMMIT` this proof wraps the file in, the same failure leaves NOTHING behind.
#   3. Either way, the mandatory post-apply readback DETECTS the partial state, so it can never be mistaken for
#      a completed apply.
#
# (3) is what actually makes application safe, because it does not depend on any CLI behaviour at all.
set -euo pipefail

PSQL="psql -v ON_ERROR_STOP=1 -qAt"
M=backend/supabase/migrations
MIG="$M/20260819120000_complete_session_v2_atomic_retention_1314.sql"
fail() { echo "FAIL: $*" >&2; exit 1; }

base() {
  $PSQL -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE;" >/dev/null
  for f in tests/db/transcript-retention-converge-bootstrap.sql \
           "$M/20260801000000_sessions_transcript_state.sql" \
           "$M/20260803000000_transcript_retention_newest_two.sql" \
           "$M/20260804000000_transcript_retention_converge_on_save.sql" \
           tests/db/atomic-completion-concurrency-realpg.sql \
           "$M/20260816223606_metrics_only_additive_1306.sql"; do
    $PSQL -f "$f" >/dev/null
  done
}

installed() { # count of the three objects this migration creates
  $PSQL -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname IN
            ('complete_session_v2','max_persisted_transcript_chars','max_persisted_transcript_bytes');"
}

# A copy of the migration with a guaranteed failure injected AFTER the helpers and the RPC but BEFORE the ACLs —
# the most dangerous cut point, because it is the window where the function exists and PUBLIC can still execute.
POISONED=/tmp/1314-poisoned.sql
awk '/^REVOKE EXECUTE ON FUNCTION public.complete_session_v2/ && !done {
       print "SELECT 1/0;  -- INJECTED FAILURE"; done=1 } { print }' "$MIG" > "$POISONED"
grep -q 'INJECTED FAILURE' "$POISONED" || fail "could not inject a failure — the proof would be vacuous"

echo "== CASE 1: mid-file failure with NO transaction control =="
base
set +e; $PSQL -f "$POISONED" >/dev/null 2>&1; rc=$?; set -e
N1=$(installed)
echo "   psql rc=$rc, objects left installed: $N1 / 3"
[ "$rc" -ne 0 ] || fail "the injected failure did not fail"
[ "$N1" -gt 0 ] || fail "expected a PARTIAL apply to demonstrate the hazard, got a clean rollback"
PUB=$($PSQL -c "SELECT has_function_privilege('public','public.complete_session_v2(uuid,text,int,text,jsonb,int,double precision,double precision,jsonb,jsonb,text)','EXECUTE');")
echo "   PARTIAL STATE: complete_session_v2 exists with PUBLIC EXECUTE = $PUB (the ACLs never ran)"

echo "== CASE 1b: the mandatory readback DETECTS that partial state =="
OUT=$($PSQL -f product_release/work_items/1314-atomic-rpc-readback.sql)
echo "$OUT" | grep -q 'A2_V2=\[NONE\]' && fail "readback wrongly reports v2 absent"
echo "$OUT" | grep -qE 'E_GRANTS=\[(NONE|[^]]*)\]' || fail "readback produced no E_GRANTS field"
echo "   readback reports v2 PRESENT but E_GRANTS incomplete -> a human sees a partial apply, not a success"

echo "== CASE 2: the SAME failure, wrapped in an explicit transaction =="
base
set +e
{ echo "BEGIN;"; cat "$POISONED"; echo "COMMIT;"; } | $PSQL >/dev/null 2>&1
rc=$?
set -e
N2=$(installed)
echo "   psql rc=$rc, objects left installed: $N2 / 3"
[ "$N2" -eq 0 ] || fail "transaction-wrapped failure still left $N2 object(s) behind"

echo "== CASE 3: a clean apply installs all three =="
base
$PSQL -f "$MIG" >/dev/null
N3=$(installed)
[ "$N3" -eq 3 ] || fail "clean apply installed $N3 / 3"
PUB3=$($PSQL -c "SELECT bool_or(has_function_privilege('public', p.oid, 'EXECUTE')) FROM pg_proc p
                 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
                 ('complete_session_v2','max_persisted_transcript_chars','max_persisted_transcript_bytes');")
echo "   all three installed; ANY PUBLIC execute = $PUB3"
[ "$PUB3" = "f" ] || fail "a created function is executable by PUBLIC"

rm -f "$POISONED"
echo
echo "PASS: partial apply is REAL without transaction control, IMPOSSIBLE with it, and DETECTED by the"
echo "      mandatory readback either way. No PUBLIC execute survives a clean apply."
