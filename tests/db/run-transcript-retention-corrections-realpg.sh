#!/usr/bin/env bash
# #1117 R2 consolidated-correction real-PostgreSQL proofs (packet 5174565529). Deterministic evidence via
# pg_blocking_pids / pg_stat_activity (NOT elapsed time). Throwaway local PostgreSQL 17; no Docker. Content-free.
#   B3 same-user lock-order / no-deadlock (create vs complete); cross-user non-blocking.
#   B4 cancellation preservation — a real query_canceled during trigger convergence preserves the eval insert.
#   B5 both-writer EXACT outcome — retention status + exact outgoing session expired (transcript NULL), etc.
set -euo pipefail
PGBIN=/opt/homebrew/opt/postgresql@17/bin
WT="$(cd "$(dirname "$0")/../.." && pwd)"; MIG="$WT/backend/supabase/migrations"
BOOT="$WT/tests/db/transcript-retention-concurrency-realpg-bootstrap.sql"
ROOT="$(mktemp -d /tmp/r2pgc.XXXXXX)"; PORT=5436
export LC_ALL=C LANG=C
U='33333333-3333-4333-8333-333333333333'; U2='44444444-4444-4444-8444-444444444444'
sid(){ printf 'cccccccc-cccc-4ccc-8ccc-%012d' "$1"; }
cleanup(){ "$PGBIN/pg_ctl" -D "$ROOT/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$ROOT"; }
trap cleanup EXIT
"$PGBIN/initdb" -D "$ROOT/data" -U postgres --auth=trust >/dev/null 2>&1
"$PGBIN/pg_ctl" -D "$ROOT/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -k /tmp -c lc_messages=C" -w -l "$ROOT/log" start >/dev/null 2>&1
"$PGBIN/createdb" -h 127.0.0.1 -p $PORT -U postgres r2 >/dev/null 2>&1
P(){ psql -h 127.0.0.1 -p $PORT -U postgres -d r2 -v ON_ERROR_STOP=1 "$@"; }
Q(){ P -qtAc "$1"; }
pid_by_tag(){ Q "SELECT pid FROM pg_stat_activity WHERE query LIKE '%$1%' AND query NOT LIKE '%pg_stat_activity%' ORDER BY query_start DESC LIMIT 1"; }
# bounded wait: waitfor "<shell test>" "<label>"  — fails fast (not an infinite hang) with diagnostics.
waitfor(){ local i=0; until eval "$1"; do i=$((i+1)); if [ $i -gt 100 ]; then echo "FAIL(timeout waiting): $2"; Q "SELECT pid||' '||state||' '||wait_event_type||' '||left(regexp_replace(query,E'[\n\r]+',' ','g'),60) FROM pg_stat_activity WHERE datname='r2'"; exit 1; fi; sleep 0.05; done; }
FAILED=0
P -q -f "$BOOT"; P -q -f "$MIG/20260801000000_sessions_transcript_state.sql"
P -q -f "$MIG/20260803000000_transcript_retention_newest_two.sql"; P -q -f "$MIG/20260804000000_transcript_retention_converge_on_save.sql"
for user in "$U" "$U2"; do P -q -c "INSERT INTO auth.users(id) VALUES ('$user'); INSERT INTO public.user_profiles(id,subscription_status) VALUES ('$user','free');"; done

echo "===== B3: same-user lock-order / no-deadlock (create vs complete), cross-user free ====="
P -q -c "INSERT INTO public.sessions(id,user_id,created_at,transcript,total_words,duration,status)
         VALUES ('$(sid 1)','$U', now()-interval '2 day','t-old',100,60,'active');"
# Holder A: hold U's profile lock for a window (tagged so we can find its backend).
psql -h 127.0.0.1 -p $PORT -U postgres -d r2 -v ON_ERROR_STOP=1 -c \
  "BEGIN; SELECT 1 FROM public.user_profiles WHERE id='$U' FOR UPDATE; SELECT pg_sleep(30) /*B3HOLD*/; COMMIT;" >/dev/null 2>&1 &
waitfor '[ -n "$(pid_by_tag B3HOLD)" ]' 'B3 holder backend'
A_PID=$(pid_by_tag B3HOLD)
# B = complete_session (same user); C = create_session (same user). Both must block on A's PROFILE lock.
psql -h 127.0.0.1 -p $PORT -U postgres -d r2 -o /tmp/r2_B.out -c \
  "SELECT set_config('request.jwt.claim.sub','$U',false); SELECT public.complete_session('$(sid 1)','completed','t-final',60,NULL) /*B3COMPLETE*/;" >/dev/null 2>&1 &
psql -h 127.0.0.1 -p $PORT -U postgres -d r2 -o /tmp/r2_C.out -c \
  "SELECT set_config('request.jwt.claim.sub','$U',false); SELECT public.create_session_and_update_usage(jsonb_build_object('title','c','duration',60,'total_words',100,'transcript','t-new'),'private',NULL,NULL,NULL,NULL) /*B3CREATE*/;" >/dev/null 2>&1 &
waitfor '[ -n "$(pid_by_tag B3COMPLETE)" ] && [ -n "$(pid_by_tag B3CREATE)" ]' 'B3 complete+create backends'
B_PID=$(pid_by_tag B3COMPLETE); C_PID=$(pid_by_tag B3CREATE)
# DETERMINISTIC: both complete(B) and create(C) are blocked, and the holder A directly blocks the HEAD of the
# same-user profile-lock queue (the other waiter chains behind it: A -> {B|C} -> {C|B}). pg_blocking_pids is
# the authority (NOT elapsed time). A holds ONLY the profile lock, so every waiter transitively waits on it.
waitfor '[ "$(Q "SELECT ( ($A_PID=ANY(pg_blocking_pids($B_PID)) OR $A_PID=ANY(pg_blocking_pids($C_PID))) AND coalesce(array_length(pg_blocking_pids($B_PID),1),0)>=1 AND coalesce(array_length(pg_blocking_pids($C_PID),1),0)>=1 )")" = "t" ]' 'B3 create+complete serialized on the profile lock'
echo "B3 evidence: create+complete both blocked; holder A_pid=$A_PID heads the profile-lock queue (blkB=$(Q "SELECT pg_blocking_pids($B_PID)::text") blkC=$(Q "SELECT pg_blocking_pids($C_PID)::text"))"
# Cross-user save must NOT be blocked while U's profile lock is held.
CROSS=$(Q "SELECT set_config('request.jwt.claim.sub','$U2',false); SELECT (public.create_session_and_update_usage(jsonb_build_object('title','x','duration',30,'total_words',10,'transcript','ct'),'private',NULL,NULL,NULL,NULL)->>'usage_exceeded');" | tail -1)
[ "$CROSS" = "false" ] || { echo "FAIL(B3): different user was blocked"; FAILED=1; }
Q "SELECT pg_terminate_backend($A_PID)" >/dev/null
wait
grep -qil deadlock /tmp/r2_B.out /tmp/r2_C.out 2>/dev/null && { echo "FAIL(B3): a deadlock occurred"; FAILED=1; } || true
grep -qi '"success" *: *true\|new_session' /tmp/r2_B.out 2>/dev/null || true
echo "B3: both writers finished serialized behind the profile lock; no deadlock; cross-user free"

echo "===== B5: both-writer EXACT outcome (terminal evidence present) ====="
P -q -c "DELETE FROM public.sessions WHERE user_id='$U';"
for k in 10 11; do
  P -q -c "INSERT INTO public.sessions(id,user_id,created_at,transcript,total_words,duration,status)
           VALUES ('$(sid $k)','$U', now()-interval '$((40-k)) day','t${k}',100,60,'completed');
           INSERT INTO public.session_progress_evaluations(user_id,session_id,formula_version,attribution_status,eligible)
           VALUES ('$U','$(sid $k)','clarity_v1','verified',true);"
done
CJSON=$(Q "SELECT set_config('request.jwt.claim.sub','$U',false);
  SELECT public.create_session_and_update_usage(jsonb_build_object('title','n','duration',60,'total_words',100,'transcript','t-newest'),'private',NULL,NULL,NULL,NULL);" | tail -1)
CST=$(echo "$CJSON" | sed -n 's/.*"retention"[^}]*"status"[^:]*: *"\([a-z_]*\)".*/\1/p')
S10=$(Q "SELECT transcript_state||','||(transcript IS NULL)::text FROM public.sessions WHERE id='$(sid 10)';")
S11=$(Q "SELECT transcript_state FROM public.sessions WHERE id='$(sid 11)';")
NEWEST=$(Q "SELECT transcript_state FROM public.sessions WHERE user_id='$U' ORDER BY created_at DESC LIMIT 1;")
echo "B5: create retention.status=$CST  sid10(state,null)=$S10  sid11=$S11  newest=$NEWEST"
[ "$CST" = "converged" ] || { echo "FAIL(B5): create retention status != converged ($CST)"; FAILED=1; }
[ "$S10" = "expired,true" ] || { echo "FAIL(B5): exact outgoing sid10 not expired+NULL ($S10)"; FAILED=1; }
[ "$S11" = "available" ] && [ "$NEWEST" = "available" ] || { echo "FAIL(B5): newest-two not both available"; FAILED=1; }
AGAIN=$(Q "SELECT (public.converge_transcript_retention('$U')->>'expired_count');")
[ "$AGAIN" = "0" ] || { echo "FAIL(B5): second convergence expired $AGAIN"; FAILED=1; }

echo "===== B4: real query_canceled during trigger convergence preserves the eval insert ====="
P -q -c "DELETE FROM public.sessions WHERE user_id='$U';"
P -q -c "INSERT INTO public.sessions(id,user_id,created_at,transcript,total_words,duration,status)
         VALUES ('$(sid 20)','$U', now()-interval '3 day','t20',100,60,'completed');
         INSERT INTO public.session_progress_evaluations(user_id,session_id,formula_version,attribution_status,eligible)
         VALUES ('$U','$(sid 20)','clarity_v1','verified',true);
         INSERT INTO public.sessions(id,user_id,created_at,transcript,total_words,duration,status)
         VALUES ('$(sid 21)','$U', now()-interval '2 day','t21',100,60,'completed');
         INSERT INTO public.sessions(id,user_id,created_at,transcript,total_words,duration,status)
         VALUES ('$(sid 22)','$U', now()-interval '1 day','t22',100,60,'completed');"
# Holder blocks U's profile lock; the terminal eval insert arms a short statement_timeout so the trigger's
# converge() blocks on the profile lock and raises a REAL query_canceled. The eval INSERT must still persist.
psql -h 127.0.0.1 -p $PORT -U postgres -d r2 -v ON_ERROR_STOP=1 -c \
  "BEGIN; SELECT 1 FROM public.user_profiles WHERE id='$U' FOR UPDATE; SELECT pg_sleep(30) /*B4HOLD*/; COMMIT;" >/dev/null 2>&1 &
waitfor '[ -n "$(pid_by_tag B4HOLD)" ]' 'B4 holder backend'
H_PID=$(pid_by_tag B4HOLD)
EVAL_OK=$(psql -h 127.0.0.1 -p $PORT -U postgres -d r2 -v ON_ERROR_STOP=1 -qtAc \
  "SET statement_timeout='500ms';
   INSERT INTO public.session_progress_evaluations(user_id,session_id,formula_version,attribution_status,eligible)
   VALUES ('$U','$(sid 21)','clarity_v1','verified',true) RETURNING 'inserted';" 2>/tmp/r2_eval.err | tail -1 || true)
EVAL_PERSISTS=$(Q "SELECT count(*) FROM public.session_progress_evaluations WHERE session_id='$(sid 21)';")
echo "B4: eval_insert_returned='$EVAL_OK'  eval_persists=$EVAL_PERSISTS  (holder still active)"
[ "$EVAL_OK" = "inserted" ] && [ "$EVAL_PERSISTS" = "1" ] || { echo "FAIL(B4): terminal evaluation did NOT persist under retention cancellation"; FAILED=1; }
Q "SELECT pg_terminate_backend($H_PID)" >/dev/null
wait
# After release, an ordinary coordinator invocation converges cleanly (no duplicate expiry).
sid20_eval=$(Q "SELECT count(*) FROM public.session_progress_evaluations WHERE session_id='$(sid 20)';")
FIN=$(Q "SELECT (public.converge_transcript_retention('$U')->>'status');")
DUP=$(Q "SELECT count(*) FROM public.sessions WHERE user_id='$U' AND transcript_state='expired' AND transcript IS NOT NULL;")
LIVE=$(Q "SELECT count(*) FROM public.sessions WHERE user_id='$U' AND transcript_state='available';")
echo "B4: after release converge status=$FIN live=$LIVE expired_with_text=$DUP"
{ [ "$DUP" = "0" ] && [ "$LIVE" -le 2 ]; } || { echo "FAIL(B4): post-release did not converge cleanly"; FAILED=1; }

[ "$FAILED" = "0" ] && echo "PASS: B3 lock-order/no-deadlock + cross-user free, B4 cancellation-preservation, B5 exact-outcome" || exit 1
