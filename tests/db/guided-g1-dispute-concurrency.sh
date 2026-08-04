#!/usr/bin/env bash
# #1046 G1 — TRUE two-connection PostgreSQL proof for guided_dispute_action_v1.
#
# A single-connection/PGlite simulation cannot prove concurrency, so this stands up a THROWAWAY local Postgres
# cluster (no Docker) and drives TWO INDEPENDENT connections:
#   Control 1 — concurrent identical dispute replay: connection A opens a txn, disputes the active action, then
#     holds the txn open across pg_sleep while connection B races the SAME action id. B blocks on A's uncommitted
#     dispute (unique action_id), and after A commits must return the IDENTICAL active successor with no duplicate
#     dispute/action/evidence mutation.
#   Control 2 — abandoned-without-dispute: a privileged setup abandons an action WITHOUT a dispute row; the RPC
#     must raise the defined fail-closed error and create/change nothing.
# Content-free: synthetic UUIDs only. Applies the G1 migration VERBATIM over the test bootstrap.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../../backend/supabase/migrations/20260802000000_guided_g1_foundation.sql"
BOOT="$HERE/guided-g1-foundation-bootstrap.sql"
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

# ── Seed: capability + project + brief(2 required points) + verified-Private recording; then start/finalize ──
psql -v ON_ERROR_STOP=1 -qX >/dev/null <<SQL
INSERT INTO auth.users(id) VALUES ('$U');
INSERT INTO public.guided_account_capability(user_id,enabled) VALUES ('$U',true);
CREATE TABLE proof_result(who text primary key, val uuid);
SQL
REC=$(q "INSERT INTO public.sessions(user_id,engine,engine_version,attribution_status,duration) VALUES ('$U','private-v2','v2','verified',50) RETURNING id")
PROJ=$(q "INSERT INTO public.guided_project(user_id,title) VALUES ('$U','p') RETURNING id")
BRIEF=$(q "INSERT INTO public.guided_brief(project_id,user_id,version,event_goal,time_budget_seconds) VALUES ('$PROJ','$U',1,'g',100) RETURNING id")
q "INSERT INTO public.guided_brief_point(brief_id,user_id,sort_order,is_required,label) VALUES ('$BRIEF','$U',0,true,'a'),('$BRIEF','$U',1,true,'b')" >/dev/null
SESS=$(q "SELECT public.guided_start_session_v1('$PROJ','$BRIEF','$REC','cue_v1','guided_action_v1','idem1')")
q "SELECT public.guided_finalize_evidence_v1('$SESS','[]'::jsonb)" >/dev/null   # both required points not_detected
FIRST=$(q "SELECT public.guided_select_action_v1('$SESS')")                     # active unmet_required (point 0)
echo "seed: session=$SESS first_action=$FIRST"

# ── Control 1: TWO connections dispute the SAME action concurrently ──
# Connection A: dispute inside a txn, record successor, then HOLD the txn open (pg_sleep) so B genuinely races.
( psql -qX -v ON_ERROR_STOP=1 <<SQL
SELECT set_config('request.jwt.claim.sub','$U',false);
BEGIN;
INSERT INTO proof_result(who,val) VALUES ('A', public.guided_dispute_action_v1('$FIRST'));
SELECT pg_sleep(2);
COMMIT;
SQL
) >/dev/null 2>&1 &
APID=$!
sleep 0.6   # A is now inside its txn holding the uncommitted dispute (unique action_id) + successor
# Connection B (independent, autocommit): races the SAME action; blocks on A's uncommitted dispute, then resolves.
psql -qX -v ON_ERROR_STOP=1 -c "SELECT set_config('request.jwt.claim.sub','$U',false)" \
  -c "INSERT INTO proof_result(who,val) VALUES ('B', public.guided_dispute_action_v1('$FIRST'))" >/dev/null 2>&1
wait "$APID"

A_SUCC=$(q "SELECT val FROM proof_result WHERE who='A'")
B_SUCC=$(q "SELECT val FROM proof_result WHERE who='B'")
DISPUTES=$(q "SELECT count(*) FROM public.guided_action_dispute WHERE action_id='$FIRST'")
ABANDONED=$(q "SELECT count(*) FROM public.guided_action WHERE id='$FIRST' AND lifecycle='abandoned'")
ACTIVE=$(q "SELECT count(*) FROM public.guided_action WHERE session_id='$SESS' AND lifecycle='active'")
EVID=$(q "SELECT count(*) FROM public.guided_evidence WHERE session_id='$SESS'")
echo "control1: A_succ=$A_SUCC B_succ=$B_SUCC disputes=$DISPUTES abandoned=$ABANDONED active=$ACTIVE evidence=$EVID"

FAIL=0
[ "$A_SUCC" = "$B_SUCC" ] && [ -n "$A_SUCC" ] || { echo "FAIL: successors differ or empty"; FAIL=1; }
[ "$DISPUTES" = "1" ] || { echo "FAIL: expected exactly 1 dispute, got $DISPUTES"; FAIL=1; }
[ "$ABANDONED" = "1" ] || { echo "FAIL: original not abandoned exactly once ($ABANDONED)"; FAIL=1; }
[ "$ACTIVE" = "1" ] || { echo "FAIL: expected exactly 1 active successor, got $ACTIVE"; FAIL=1; }
[ "$EVID" = "2" ] || { echo "FAIL: evidence mutated ($EVID, expected 2)"; FAIL=1; }

# Sequential lost-response replay stays green: retry the (now abandoned) FIRST → same successor, still 1 dispute.
R=$(q "SELECT public.guided_dispute_action_v1('$FIRST')")
D2=$(q "SELECT count(*) FROM public.guided_action_dispute WHERE action_id='$FIRST'")
[ "$R" = "$A_SUCC" ] && [ "$D2" = "1" ] || { echo "FAIL: sequential retry not idempotent (r=$R d=$D2)"; FAIL=1; }
echo "control1 sequential-retry: r=$R disputes=$D2"

# ── Control 2: abandoned-without-dispute must fail closed and mutate nothing ──
# Build a fresh active action on a second session, then privileged-abandon it WITHOUT a dispute.
REC2=$(q "INSERT INTO public.sessions(user_id,engine,engine_version,attribution_status,duration) VALUES ('$U','private-v2','v2','verified',50) RETURNING id")
SESS2=$(q "SELECT public.guided_start_session_v1('$PROJ','$BRIEF','$REC2','cue_v1','guided_action_v1','idem2')")
q "SELECT public.guided_finalize_evidence_v1('$SESS2','[]'::jsonb)" >/dev/null
ACT2=$(q "SELECT public.guided_select_action_v1('$SESS2')")
q "UPDATE public.guided_action SET lifecycle='abandoned' WHERE id='$ACT2'" >/dev/null   # privileged: no dispute row
set +e
ERR=$(psql -tAqX -c "SELECT set_config('request.jwt.claim.sub','$U',false)" -c "SELECT public.guided_dispute_action_v1('$ACT2')" 2>&1 >/dev/null)
RC=$?
set -e
D3=$(q "SELECT count(*) FROM public.guided_action_dispute WHERE action_id='$ACT2'")
ACT2_ACTIVE=$(q "SELECT count(*) FROM public.guided_action WHERE session_id='$SESS2' AND lifecycle='active'")
echo "control2: rc=$RC err=$(echo "$ERR" | grep -oiE 'action is not active' || echo '<none>') disputes=$D3 active=$ACT2_ACTIVE"
[ "$RC" != "0" ] && echo "$ERR" | grep -qiE 'action is not active' || { echo "FAIL: abandoned-without-dispute did not fail closed"; FAIL=1; }
[ "$D3" = "0" ] || { echo "FAIL: dispute created for abandoned-without-dispute ($D3)"; FAIL=1; }
[ "$ACT2_ACTIVE" = "0" ] || { echo "FAIL: successor created for abandoned-without-dispute ($ACT2_ACTIVE)"; FAIL=1; }

echo "postgres: $(postgres --version)"
if [ "$FAIL" = "0" ]; then echo "RESULT: PASS (true two-connection proof)"; else echo "RESULT: FAIL"; exit 1; fi
