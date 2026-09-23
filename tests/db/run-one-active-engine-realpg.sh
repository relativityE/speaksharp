#!/usr/bin/env bash
# #1476 — ACTUAL PostgreSQL (not PGlite) proof of the one-account/one-engine fence and its migration ordering.
#
# PGlite is single-connection, so it cannot show races. This starts a throwaway PostgreSQL cluster, applies the
# VERBATIM migration chain, and drives CONCURRENT psql sessions. Every verdict below is read back from the database
# and printed with a positive PASS/FAIL marker; the script exits non-zero on any FAIL.
#
# Usage: tests/db/run-one-active-engine-realpg.sh            (needs initdb/pg_ctl/psql on PATH; nothing leaves /tmp)
set -euo pipefail
# macOS PostgreSQL refuses to start ("postmaster became multithreaded") without a valid locale.
export LC_ALL=${LC_ALL:-en_US.UTF-8} LANG=${LANG:-en_US.UTF-8}
cd "$(dirname "$0")/../.."
M=backend/supabase/migrations
U=11111111-1111-4111-8111-111111111111
O=22222222-2222-4222-8222-222222222222
FR=33333333-3333-4333-8333-333333333333   # Free tier (session cap 1)
PORT=${PORT:-55476}
DATA=$(mktemp -d /tmp/pg1476.XXXXXX)
initdb -D "$DATA" -A trust -U postgres >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/log" -w start >/dev/null
trap 'pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT
FAILS=0
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*"; FAILS=$((FAILS+1)); }
q() { psql -h /tmp -p "$PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -AtqX -c "$2"; }
qf() { psql -h /tmp -p "$PORT" -U postgres -d "$1" -v ON_ERROR_STOP=1 -AtqX -f "$2" >/dev/null; }
as_user() { echo "SELECT set_config('request.jwt.claim.sub','$1',false);"; }

# ---------- DB 1: the fence (writer chain + lease + #1476) ----------
q postgres "CREATE DATABASE fence" >/dev/null
qf fence tests/db/one-active-engine-realpg-bootstrap.sql
for f in 20260801000000_sessions_transcript_state 20260803000000_transcript_retention_newest_two 20260731120000_session_progress_evaluations \
         20260804000000_transcript_retention_converge_on_save 20260805000000_transcript_retention_preflight \
         20260819120000_complete_session_v2_atomic_retention_1314 20260908120000_transcript_retention_newest_one \
         20260607040000_active_recording_lease 20260923120000_one_active_engine_per_account_1476; do qf fence "$M/$f.sql"; done
q fence "SELECT public.activate_transcript_retention_newest_one()" >/dev/null
reset() { q fence "DELETE FROM public.sessions; DELETE FROM public.active_recording_lease;" >/dev/null; }
active_takes() { q fence "SELECT count(*) FROM public.sessions WHERE user_id='$1' AND status='active'"; }
START_SQL() { echo "SELECT public.create_session_and_update_usage('{\"title\":\"take\",\"duration\":0,\"total_words\":0$([ -n "${1:-}" ] && echo ",\"lease_id\":\"$1\"")}'::jsonb,'private');"; }

# Case 1 — two devices press Start at the same instant (each acquires its own lease, then creates).
reset
for L in aaaaaaaa-0000-4000-8000-000000000001 aaaaaaaa-0000-4000-8000-000000000002; do
  ( psql -h /tmp -p "$PORT" -U postgres -d fence -AtqX -c "$(as_user $U) BEGIN; SELECT public.acquire_recording_lease('$L','dev',false); SELECT pg_sleep(0.3); $(START_SQL $L) COMMIT;" >/tmp/race1-$L.out 2>&1 || true ) &
done; wait
n=$(active_takes $U); [ "$n" = "1" ] && pass "simultaneous same-account Starts: exactly one active take (got $n)" || fail "simultaneous Starts: $n active takes"

# Case 2 — stale-holder race: an abandoned lease is stale; two devices race to replace it without force.
reset
q fence "$(as_user $U) SELECT public.acquire_recording_lease('aaaaaaaa-0000-4000-8000-0000000000f0','gone',false); UPDATE public.active_recording_lease SET heartbeat_at = now() - interval '20 seconds';" >/dev/null
for L in aaaaaaaa-0000-4000-8000-000000000003 aaaaaaaa-0000-4000-8000-000000000004; do
  ( psql -h /tmp -p "$PORT" -U postgres -d fence -AtqX -c "$(as_user $U) BEGIN; SELECT public.acquire_recording_lease('$L','dev',false); SELECT pg_sleep(0.3); $(START_SQL $L) COMMIT;" >/tmp/race2-$L.out 2>&1 || true ) &
done; wait
n=$(active_takes $U); [ "$n" = "1" ] && pass "stale-holder race: exactly one device took over the stale lease and records (got $n)" || fail "stale-holder race: $n active takes"

# Case 3 — OLD client: implicit lease renewed by its heartbeat; a new device is blocked; a forced take-over displaces it.
reset
id=$(q fence "$(as_user $U) $(START_SQL)" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
q fence "UPDATE public.active_recording_lease SET heartbeat_at = now() - interval '10 seconds' WHERE user_id='$U';" >/dev/null
q fence "$(as_user $U) UPDATE public.sessions SET duration = 30 WHERE id='$id';" >/dev/null   # the old client's heartbeat_session write
renewed=$(q fence "SELECT heartbeat_at > now() FROM public.active_recording_lease WHERE user_id='$U' AND lease_id='$id'" | tail -1)
[ "$renewed" = "t" ] && pass "old-client renewal: its heartbeat keeps the implicit lease ahead of the staleness window" || fail "old-client renewal: lease not renewed ($renewed)"
blocked=$(q fence "$(as_user $U) SELECT (public.acquire_recording_lease('aaaaaaaa-0000-4000-8000-000000000005','dev',false))->>'reason';" | tail -1)
[ "$blocked" = "held_by_other" ] && pass "old-client take blocks a new device without take-over" || fail "old client did not block: $blocked"
q fence "$(as_user $U) SELECT public.acquire_recording_lease('aaaaaaaa-0000-4000-8000-000000000005','dev',true);" >/dev/null
if q fence "$(as_user $U) UPDATE public.sessions SET duration = 60 WHERE id='$id';" >/dev/null 2>&1; then fail "old client kept recording after take-over"; else pass "old-client take-over: its next heartbeat write is refused"; fi

# Case 4 — displaced writes: heartbeat and transcript that keep the take recording are refused; its completion is saved.
if q fence "$(as_user $U) UPDATE public.sessions SET transcript='late', duration=90 WHERE id='$id';" >/dev/null 2>&1; then fail "displaced transcript write accepted while active"; else pass "displaced transcript/heartbeat write refused while it would keep the take active"; fi
q fence "$(as_user $U) UPDATE public.sessions SET status='completed', duration=60, transcript='what was recorded' WHERE id='$id';" >/dev/null && st=$(q fence "SELECT status FROM public.sessions WHERE id='$id'" | tail -1)
[ "${st:-}" = "completed" ] && pass "displaced completion is SAVED (recorded work stays recoverable)" || fail "displaced completion not saved (${st:-none})"
if q fence "$(as_user $U) UPDATE public.sessions SET status='failed' WHERE id='$id'; UPDATE public.sessions SET status='completed' WHERE id='$id';" >/dev/null 2>&1; then fail "a failed take was revived"; else pass "a take that failed stays closed"; fi

# Case 5 — owner isolation: another account's live take never blocks this one.
reset
q fence "$(as_user $O) SELECT public.acquire_recording_lease('aaaaaaaa-0000-4000-8000-000000000006','dev',false); $(START_SQL aaaaaaaa-0000-4000-8000-000000000006)" >/dev/null
q fence "$(as_user $U) SELECT public.acquire_recording_lease('aaaaaaaa-0000-4000-8000-000000000007','dev',false); $(START_SQL aaaaaaaa-0000-4000-8000-000000000007)" >/dev/null
[ "$(active_takes $U)" = "1" ] && [ "$(active_takes $O)" = "1" ] && pass "owner isolation: each account records its own one take" || fail "owner isolation"

# Case 6 — PM RETURN on 040da46a: DELAYED STOP. Device A's page unmounts mid-take; its engine is still stopping (the
# client heartbeats until the stop resolves, then releases). Device B presses Start throughout: it must be refused while
# A's engine may still run, and may record once A has released. A's save lands after B starts.
reset
LA=aaaaaaaa-0000-4000-8000-0000000000a1; LB=aaaaaaaa-0000-4000-8000-0000000000b1
ida=$(q fence "$(as_user $U) SELECT public.acquire_recording_lease('$LA','A',false); $(START_SQL $LA)" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
( for i in 1 2 3; do q fence "$(as_user $U) SELECT public.heartbeat_recording_lease('$LA');" >/dev/null; sleep 1; done ) &   # A: stopping, still heartbeating
sleep 0.5
bdur=$(q fence "$(as_user $U) SELECT (public.acquire_recording_lease('$LB','B',false))->>'reason';" | tail -1)
wait
[ "$bdur" = "held_by_other" ] && pass "delayed stop: device B is refused while A's engine is still stopping" || fail "delayed stop: B got '$bdur' while A still stopping"
q fence "$(as_user $U) SELECT public.release_recording_lease('$LA');" >/dev/null   # A's stop resolved → release
q fence "$(as_user $U) SELECT public.acquire_recording_lease('$LB','B',false); $(START_SQL $LB)" >/dev/null
q fence "$(as_user $U) UPDATE public.sessions SET status='completed', duration=45, transcript='what A recorded' WHERE id='$ida';" >/dev/null 2>&1 && sa=$(q fence "SELECT status FROM public.sessions WHERE id='$ida'" | tail -1)
[ "${sa:-}" = "completed" ] && pass "delayed stop: A's save lands after release, even with B recording" || fail "delayed stop: A's save lost (${sa:-refused})"
[ "$(active_takes $U)" = "1" ] && pass "delayed stop: exactly one engine authorized (B)" || fail "delayed stop: $(active_takes $U) active takes"

# Case 7 — PM RETURN on 040da46a: a Start whose obligation load takes longer than the 15 s lease window.
# 7a (the defect on 040da46a): no heartbeat until the load returns → the lease goes stale, B takes it without force,
#     and A's revalidation reports the loss, so A's Start is refused before any engine work.
reset
LA=aaaaaaaa-0000-4000-8000-0000000000a2; LB=aaaaaaaa-0000-4000-8000-0000000000b2
q fence "$(as_user $U) SELECT public.acquire_recording_lease('$LA','A',false); UPDATE public.active_recording_lease SET heartbeat_at = now() - interval '16 seconds' WHERE lease_id='$LA';" >/dev/null
b7=$(q fence "$(as_user $U) SELECT (public.acquire_recording_lease('$LB','B',false))->>'acquired';" | tail -1)
v7=$(q fence "$(as_user $U) SELECT (public.heartbeat_recording_lease('$LA'))->>'valid';" | tail -1)
c7=$(q fence "$(as_user $U) $(START_SQL $LA)" 2>&1 | tail -1)
[ "$b7" = "true" ] && [ "$v7" = "false" ] && ! echo "$c7" | grep -q '"new_session": {' && pass "unheartbeated slow load: B takes the stale lease; A's revalidation is false and A cannot create" || fail "7a: b=$b7 valid=$v7 create=$c7"
# 7b (the correction): the heartbeat runs from acquire, through a 16 s load, on a separate connection from B.
reset
q fence "$(as_user $U) SELECT public.acquire_recording_lease('$LA','A',false);" >/dev/null
( for i in 1 2 3 4; do q fence "$(as_user $U) SELECT public.heartbeat_recording_lease('$LA');" >/dev/null; sleep 4; done ) &
sleep 15.5
b7b=$(q fence "$(as_user $U) SELECT (public.acquire_recording_lease('$LB','B',false))->>'reason';" | tail -1)
wait
v7b=$(q fence "$(as_user $U) SELECT (public.heartbeat_recording_lease('$LA'))->>'valid';" | tail -1)
q fence "$(as_user $U) $(START_SQL $LA)" >/dev/null
[ "$b7b" = "held_by_other" ] && [ "$v7b" = "true" ] && [ "$(active_takes $U)" = "1" ] && pass "heartbeated 16 s load: B is refused, A still owns the lease and records one take" || fail "7b: b=$b7b valid=$v7b active=$(active_takes $U)"

# ---------- DB 3: PM RETURN on 040da46a — a take ALREADY RECORDING when the migration applies (Free and Pro) ----------
for T in "pro:$U" "free:$FR"; do
  tier=${T%%:*}; usr=${T#*:}; D=premig_$tier
  q postgres "CREATE DATABASE $D" >/dev/null
  qf $D tests/db/one-active-engine-realpg-bootstrap.sql
  for f in 20260801000000_sessions_transcript_state 20260803000000_transcript_retention_newest_two 20260731120000_session_progress_evaluations \
           20260804000000_transcript_retention_converge_on_save 20260805000000_transcript_retention_preflight \
           20260819120000_complete_session_v2_atomic_retention_1314 20260908120000_transcript_retention_newest_one \
           20260607040000_active_recording_lease; do qf $D "$M/$f.sql"; done
  q $D "SELECT public.activate_transcript_retention_newest_one()" >/dev/null
  legacy=$(q $D "$(as_user $usr) $(START_SQL)" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
  qf $D "$M/20260923120000_one_active_engine_per_account_1476.sql"
  # A current client (device B) and a second OLD client press Start at the same instant, each on its own connection.
  ( psql -h /tmp -p "$PORT" -U postgres -d $D -AtqX -c "$(as_user $usr) BEGIN; SELECT public.acquire_recording_lease('aaaaaaaa-0000-4000-8000-0000000000c1','B',false); $(START_SQL aaaaaaaa-0000-4000-8000-0000000000c1) COMMIT;" >/dev/null 2>&1 || true ) &
  ( psql -h /tmp -p "$PORT" -U postgres -d $D -AtqX -c "$(as_user $usr) $(START_SQL)" >/dev/null 2>&1 || true ) &
  wait
  n=$(q $D "SELECT count(*) FROM public.sessions WHERE user_id='$usr' AND status='active'")
  holder=$(q $D "SELECT lease_id FROM public.active_recording_lease WHERE user_id='$usr'")
  [ "$n" = "1" ] && [ "$holder" = "$legacy" ] && pass "[$tier] migration over a running old take: it holds the account lease; concurrent new + old Starts add no engine (active=$n)" || fail "[$tier] pre-migration take: active=$n holder=$holder legacy=$legacy"
  q $D "$(as_user $usr) UPDATE public.sessions SET duration = 30 WHERE id='$legacy';" >/dev/null && pass "[$tier] the running old take keeps recording (its heartbeat renews its lease)" || fail "[$tier] old take's heartbeat refused before any take-over"
  q $D "$(as_user $usr) SELECT public.acquire_recording_lease('aaaaaaaa-0000-4000-8000-0000000000c2','B',true); $(START_SQL aaaaaaaa-0000-4000-8000-0000000000c2)" >/dev/null
  if q $D "$(as_user $usr) UPDATE public.sessions SET duration = 60 WHERE id='$legacy';" >/dev/null 2>&1; then fail "[$tier] displaced old take kept recording"; else pass "[$tier] after an explicit take-over the old take can no longer record"; fi
  q $D "$(as_user $usr) UPDATE public.sessions SET status='completed', duration=60 WHERE id='$legacy';" >/dev/null 2>&1 && st=$(q $D "SELECT status FROM public.sessions WHERE id='$legacy'" | tail -1)
  n=$(q $D "SELECT count(*) FROM public.sessions WHERE user_id='$usr' AND status='active'")
  [ "${st:-}" = "completed" ] && [ "$n" = "1" ] && pass "[$tier] the old take's recording is saved; exactly one engine authorized (the take-over)" || fail "[$tier] after take-over: old=${st:-refused} active=$n"
  st=""
done

# ---------- DB 2: #1521 applied AFTER #1525 (attribution + progress chain) ----------
q postgres "CREATE DATABASE progress" >/dev/null
qf progress tests/db/attribution-authority-bootstrap.sql
qf progress "$M/20260731120000_session_progress_evaluations.sql"; qf progress "$M/20260803010000_session_attribution_authority.sql"
q progress "CREATE TABLE IF NOT EXISTS public.objective_source_recording (session_id uuid PRIMARY KEY, user_id uuid NOT NULL, registered_at timestamptz NOT NULL DEFAULT now()); CREATE TABLE IF NOT EXISTS public.tier_configs (tier_name text PRIMARY KEY, max_concurrent_sessions int);" >/dev/null
for f in 20260812030000_progress_cohort_mode_separation_1265 20260816223606_metrics_only_additive_1306 20260817140000_repoint_analytics_summary_flat_1306 \
         20260607040000_active_recording_lease 20260923120000_one_active_engine_per_account_1476; do qf progress "$M/$f.sql"; done
if [ -f "$M/20260915130000_progress_evaluation_filler_counts_authority_1471.sql" ]; then
  qf progress "$M/20260915130000_progress_evaluation_filler_counts_authority_1471.sql" && pass "#1521 migration applies cleanly AFTER #1525" || fail "#1521 after #1525 failed to apply"
else
  echo "INFO #1521 migration not in this tree; supply it with MIG1521=path"; [ -n "${MIG1521:-}" ] && { qf progress "$MIG1521" && pass "#1521 migration (from MIG1521) applies cleanly AFTER #1525" || fail "#1521 after #1525 failed to apply"; }
fi
q progress "INSERT INTO auth.users (id) VALUES ('$U') ON CONFLICT DO NOTHING;" >/dev/null
L=aaaaaaaa-0000-4000-8000-000000000008
sid=$(q progress "$(as_user $U) SELECT public.acquire_recording_lease('$L','dev',false); INSERT INTO public.sessions (user_id,status,duration,total_words,wpm,transcript,engine,engine_version,model_name,device_type,attribution_status,filler_counts,lease_id) VALUES ('$U','active',93,141,91,'a clean transcript with plenty of ordinary words','private','private_v2:whisper-base.en','whisper-base.en','browser','pending','{\"um\":2}'::jsonb,'$L') RETURNING id;" | tail -1)
q progress "SET ROLE service_role; SELECT public.issue_attribution_intent_v1('$U','rec-$sid','private','base'); SELECT public.bind_attribution_intent_v1('$sid','rec-$sid'); UPDATE public.sessions SET status='completed' WHERE id='$sid'; SELECT public.attest_session_engine_v1('$sid','{\"provider\":\"transformers-js\",\"model_id\":\"base\",\"fallback_occurred\":false,\"cloud_used\":false}'::jsonb); RESET ROLE;" >/dev/null
owed=$(q progress "$(as_user $U) SELECT public.get_progress_obligations()->0->>'state';" | tail -1)
[ "$owed" = "owed" ] && pass "after both migrations, a completed attested take is listed as owed" || fail "obligation state: $owed"
evid=$(q progress "$(as_user $U) SELECT public.record_progress_evaluation('$sid');" | tail -1)
left=$(q progress "$(as_user $U) SELECT jsonb_array_length(public.get_progress_obligations());" | tail -1)
[ -n "$evid" ] && [ "$left" = "0" ] && pass "#1521's evaluator settles it and the obligation clears (evaluation $evid)" || fail "settle after #1521: eval=$evid left=$left"

echo "SUMMARY fails=$FAILS"
[ "$FAILS" = "0" ]
