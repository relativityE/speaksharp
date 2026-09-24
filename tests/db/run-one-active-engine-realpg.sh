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

# Case 0 — PM RETURN (pre-push, F4): an OLD tab's held Start resumes after the new release is live, while ANOTHER device
# has fresh Progress debt. The old bundle does not re-check freshness on resume (main: SpeechRuntimeController resumes at
# `transition()` with startRecording(..., true, ...)), and it cannot see v2-only or server obligations. What reaches the
# server is exactly this call: an old-client placeholder create (no lease, duration 0, its idempotency key). It must be
# refused while that debt is held, for as long as a current client would hold its own Start (the 60 s release bound, plus
# slack), and allowed once the debt is settled or the bound has passed. Free and Pro.
EVAL_SQL() { echo "INSERT INTO public.session_progress_evaluations (user_id, session_id, formula_version, duration_seconds, word_count, clarity_evidence_available, eligible, exclusion_reasons) VALUES ('$1','$2','clarity_v1',60,100,false,false,'{too_short}');"; }   # an ineligible evaluation settles the debt too
f4case() {  # $1 user $2 tier
  local usr=$1 tier=$2 LB=bbbbbbbb-0000-4000-8000-0000000000a4 B out bad=""
  reset; q fence "DELETE FROM public.session_progress_evaluations" >/dev/null
  # Device B (current bundle) records a take and completes it; its Progress evaluation has not landed (debt).
  B=$(q fence "$(as_user $usr) SELECT public.acquire_recording_lease('$LB','B',false); $(START_SQL $LB)" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
  q fence "$(as_user $usr) SELECT public.release_recording_lease('$LB'); UPDATE public.sessions SET status='completed', duration=60, updated_at=now() WHERE id='$B';" >/dev/null
  # Old tab A's resumed Start reaches the server.
  out=$(q fence "$(as_user $usr) $(START_SQL)" 2>&1 | tail -1 || true)
  echo "$out" | grep -q '"new_session": {' && bad="$bad old-tab-started-while-debt-held"
  echo "$out" | grep -q '"error": "progress_evaluation_pending"' || bad="$bad refusal=($out)"
  [ "$(active_takes $usr)" = "0" ] || bad="$bad active=$(active_takes $usr)"
  # A current client is governed by its own Start gate (hydrate + bounded release), not by this guard.
  q fence "$(as_user $usr) SELECT public.acquire_recording_lease('bbbbbbbb-0000-4000-8000-0000000000a5','C',false); $(START_SQL bbbbbbbb-0000-4000-8000-0000000000a5)" 2>/dev/null | tail -1 | grep -q '"new_session": {' || bad="$bad current-client-blocked"
  q fence "$(as_user $usr) SELECT public.release_recording_lease('bbbbbbbb-0000-4000-8000-0000000000a5'); UPDATE public.sessions SET status='failed' WHERE lease_id='bbbbbbbb-0000-4000-8000-0000000000a5';" >/dev/null
  # B's evaluation lands: the debt is settled, and A may start.
  q fence "$(EVAL_SQL $usr $B)" >/dev/null
  q fence "$(as_user $usr) $(START_SQL)" 2>/dev/null | tail -1 | grep -q '"new_session": {' || bad="$bad blocked-after-settled"
  [ -z "$bad" ] && pass "[$tier] F4: an old tab's resumed Start is refused while another device's Progress debt is held; allowed once settled; current clients unaffected" || fail "[$tier] F4:$bad"
  # Bounded: past the release bound the old tab is no longer held (the debt itself stays owed on the server).
  reset; q fence "DELETE FROM public.session_progress_evaluations" >/dev/null
  B=$(q fence "$(as_user $usr) SELECT public.acquire_recording_lease('$LB','B',false); $(START_SQL $LB)" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
  q fence "$(as_user $usr) SELECT public.release_recording_lease('$LB'); UPDATE public.sessions SET status='completed', duration=60 WHERE id='$B';" >/dev/null
  q fence "UPDATE public.sessions SET updated_at = now() - interval '5 minutes', created_at = now() - interval '7 minutes' WHERE id='$B';" >/dev/null
  q fence "$(as_user $usr) $(START_SQL)" 2>/dev/null | tail -1 | grep -q '"new_session": {' && pass "[$tier] F4: the hold is bounded — past the release bound an old tab is not locked out" || fail "[$tier] F4: old tab locked out beyond the bound"
}
f4case "$U" pro; f4case "$FR" free

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
  older=""
  if [ "$tier" = pro ]; then   # Pro's legacy cap (50) let an old client run TWO takes before the fence existed
    older=$(q $D "$(as_user $usr) $(START_SQL)" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
    q $D "UPDATE public.sessions SET created_at = now() - interval '1 minute' WHERE id='$older'" >/dev/null
  fi
  legacy=$(q $D "$(as_user $usr) $(START_SQL)" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
  qf $D "$M/20260923120000_one_active_engine_per_account_1476.sql"
  # A current client (device B) and a second OLD client press Start at the same instant, each on its own connection.
  ( psql -h /tmp -p "$PORT" -U postgres -d $D -AtqX -c "$(as_user $usr) BEGIN; SELECT public.acquire_recording_lease('aaaaaaaa-0000-4000-8000-0000000000c1','B',false); $(START_SQL aaaaaaaa-0000-4000-8000-0000000000c1) COMMIT;" >/dev/null 2>&1 || true ) &
  ( psql -h /tmp -p "$PORT" -U postgres -d $D -AtqX -c "$(as_user $usr) $(START_SQL)" >/dev/null 2>&1 || true ) &
  wait
  n=$(q $D "SELECT count(*) FROM public.sessions WHERE user_id='$usr' AND status='active' AND recording_fenced_at IS NULL")
  holder=$(q $D "SELECT lease_id FROM public.active_recording_lease WHERE user_id='$usr'")
  [ "$n" = "1" ] && [ "$holder" = "$legacy" ] && pass "[$tier] migration over a running old take: it holds the account lease; concurrent new + old Starts add no engine (active=$n)" || fail "[$tier] pre-migration take: active=$n holder=$holder legacy=$legacy"
  q $D "$(as_user $usr) UPDATE public.sessions SET duration = 30 WHERE id='$legacy';" >/dev/null && pass "[$tier] the running old take keeps recording (its heartbeat renews its lease)" || fail "[$tier] old take's heartbeat refused before any take-over"
  q $D "$(as_user $usr) SELECT public.acquire_recording_lease('aaaaaaaa-0000-4000-8000-0000000000c2','B',true); $(START_SQL aaaaaaaa-0000-4000-8000-0000000000c2)" >/dev/null
  if q $D "$(as_user $usr) UPDATE public.sessions SET duration = 60 WHERE id='$legacy';" >/dev/null 2>&1; then fail "[$tier] displaced old take kept recording"; else pass "[$tier] after an explicit take-over the old take can no longer record"; fi
  q $D "$(as_user $usr) UPDATE public.sessions SET status='completed', duration=60 WHERE id='$legacy';" >/dev/null 2>&1 && st=$(q $D "SELECT status FROM public.sessions WHERE id='$legacy'" | tail -1)
  n=$(q $D "SELECT count(*) FROM public.sessions WHERE user_id='$usr' AND status='active' AND recording_fenced_at IS NULL")
  [ "${st:-}" = "completed" ] && [ "$n" = "1" ] && pass "[$tier] the old take's recording is saved; exactly one engine authorized (the take-over)" || fail "[$tier] after take-over: old=${st:-refused} active=$n"
  if [ -n "$older" ]; then
    # The newest take held the lease; the OLDER concurrent one was displaced at apply — permanently, even after both end.
    if q $D "$(as_user $usr) UPDATE public.sessions SET duration = 45 WHERE id='$older';" >/dev/null 2>&1; then fail "[$tier] older concurrent legacy take kept recording after the migration"; else pass "[$tier] the older concurrent legacy take is fenced by the migration backfill (it may still save)"; fi
    q $D "$(as_user $usr) UPDATE public.sessions SET status='completed' WHERE id='$older';" >/dev/null 2>&1 && pass "[$tier] the fenced older take's save lands" || fail "[$tier] the fenced older take could not save"
  fi
  st=""
  # PM RETURNs on the 1ca8d72f backfill: the previous writer discarded the payload lease_id, so NO pre-#1476 row can be
  # proven to be a live lease's take. An account holding a live lease with an active take created during it must make
  # the migration REFUSE (nothing changed; every take keeps running under the old schema), and the same migration must
  # apply once that cohort is quiet. Never a guess that fences a healthy take or authorizes two.
  premig() {  # $1 db name
    q postgres "CREATE DATABASE $1" >/dev/null
    qf $1 tests/db/one-active-engine-realpg-bootstrap.sql
    for f in 20260801000000_sessions_transcript_state 20260803000000_transcript_retention_newest_two 20260731120000_session_progress_evaluations \
             20260804000000_transcript_retention_converge_on_save 20260805000000_transcript_retention_preflight \
             20260819120000_complete_session_v2_atomic_retention_1314 20260908120000_transcript_retention_newest_one \
             20260607040000_active_recording_lease; do qf $1 "$M/$f.sql"; done
    q $1 "SELECT public.activate_transcript_retention_newest_one()" >/dev/null
  }
  newid() { tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])'; }
  state() { q $1 "SELECT coalesce(lease_id::text,'none')||'/'||coalesce(recording_fenced_reason,'unfenced') FROM public.sessions WHERE id='$2'"; }
  hasfence() { q $1 "SELECT count(*) FROM information_schema.columns WHERE table_name='sessions' AND column_name='recording_fenced_at'"; }
  refuses() {  # $1 db; the apply must fail with the named reason and leave the schema untouched
    local out; out=$(psql -h /tmp -p "$PORT" -U postgres -d $1 -v ON_ERROR_STOP=1 -AtqX -f "$M/20260923120000_one_active_engine_per_account_1476.sql" 2>&1 >/dev/null && echo APPLIED || true)
    echo "$out" | grep -q 'one_active_engine_1476: 1 account(s) hold a live recording lease' && [ "$(hasfence $1)" = "0" ]
  }
  quiet_then_apply() {  # $1 db, $2 lease, rest: sessions to end — then the SAME migration applies
    local db=$1 l=$2; shift 2
    for sid in "$@"; do q $db "$(as_user $usr) UPDATE public.sessions SET status='completed', duration=30 WHERE id='$sid';" >/dev/null; done
    q $db "$(as_user $usr) SELECT public.release_recording_lease('$l');" >/dev/null
    qf $db "$M/20260923120000_one_active_engine_per_account_1476.sql" && [ "$(hasfence $db)" = "1" ]
  }
  L1=eeeeeeee-0000-4000-8000-0000000000c9
  # A — current client, old DB: live L + its take C.
  premig a_$tier
  c=$(q a_$tier "$(as_user $usr) SELECT public.acquire_recording_lease('$L1','new frontend',false); $(START_SQL $L1)" | newid)
  bad=""; refuses a_$tier || bad="$bad not-refused"
  q a_$tier "$(as_user $usr) SELECT public.heartbeat_recording_lease('$L1'); UPDATE public.sessions SET duration = 30 WHERE id='$c';" >/dev/null 2>&1 || bad="$bad take-disturbed"
  quiet_then_apply a_$tier $L1 $c || bad="$bad no-apply-at-quiet-point"
  [ -z "$bad" ] && pass "[$tier] A: live lease + its take — apply REFUSED (schema untouched, the take keeps recording); applies at a quiet point" || fail "[$tier] A:$bad"
  if [ "$tier" = free ]; then
    # Free's pre-#1476 cap is 1: a SECOND active take (B, B2, E, and F's legacy-beside-holder) cannot exist. Asserted.
    premig f_$tier
    q f_$tier "$(as_user $usr) $(START_SQL)" >/dev/null
    second=$(q f_$tier "$(as_user $usr) $(START_SQL)" 2>&1 | tail -1 || true)
    echo "$second" | grep -q '"max_concurrent_sessions_reached"' && pass "[$tier] multi-take cohorts unreachable on Free: the pre-#1476 writer refuses a second active take" || fail "[$tier] Free admitted a second pre-#1476 take: $second"
  else
    # B — mixed: an older legacy take O (before L), then L and its take C.
    premig b_$tier
    o=$(q b_$tier "$(as_user $usr) $(START_SQL)" | newid); q b_$tier "UPDATE public.sessions SET created_at = now() - interval '2 minutes' WHERE id='$o'" >/dev/null
    c=$(q b_$tier "$(as_user $usr) SELECT public.acquire_recording_lease('$L1','new frontend',false); $(START_SQL $L1)" | newid)
    bad=""; refuses b_$tier || bad="$bad not-refused"; quiet_then_apply b_$tier $L1 $o $c || bad="$bad no-apply"
    [ -z "$bad" ] && pass "[$tier] B: mixed cohort — apply REFUSED untouched; applies at a quiet point" || fail "[$tier] B:$bad"
    # B2 — a legacy take O inside L's window, BEFORE the current take C.
    premig b2_$tier
    q b2_$tier "$(as_user $usr) SELECT public.acquire_recording_lease('$L1','new frontend',false);" >/dev/null
    o=$(q b2_$tier "$(as_user $usr) $(START_SQL)" | newid); q b2_$tier "UPDATE public.sessions SET created_at = now() - interval '1 second' WHERE id='$o'" >/dev/null
    c=$(q b2_$tier "$(as_user $usr) $(START_SQL $L1)" | newid)
    bad=""; refuses b2_$tier || bad="$bad not-refused"; quiet_then_apply b2_$tier $L1 $o $c || bad="$bad no-apply"
    [ -z "$bad" ] && pass "[$tier] B2: legacy take in the window before the current take — REFUSED untouched; applies when quiet" || fail "[$tier] B2:$bad"
    # E — PM: the old client starts AFTER the current client (C, then O, both in L's window).
    premig e_$tier
    c=$(q e_$tier "$(as_user $usr) SELECT public.acquire_recording_lease('$L1','new frontend',false); $(START_SQL $L1)" | newid)
    q e_$tier "UPDATE public.sessions SET created_at = now() - interval '1 second' WHERE id='$c'" >/dev/null
    o=$(q e_$tier "$(as_user $usr) $(START_SQL)" | newid)
    bad=""; refuses e_$tier || bad="$bad not-refused"
    for sid in $c $o; do q e_$tier "$(as_user $usr) UPDATE public.sessions SET duration = 30 WHERE id='$sid';" >/dev/null 2>&1 || bad="$bad take-disturbed"; done
    quiet_then_apply e_$tier $L1 $c $o || bad="$bad no-apply"
    [ -z "$bad" ] && pass "[$tier] E: old client AFTER the current client — REFUSED untouched (neither healthy take fenced); applies when quiet" || fail "[$tier] E:$bad"
    # E2 — PM: live L still PREPARING (no take yet) while an old client records O in its window.
    premig e2_$tier
    q e2_$tier "$(as_user $usr) SELECT public.acquire_recording_lease('$L1','new frontend',false);" >/dev/null
    o=$(q e2_$tier "$(as_user $usr) $(START_SQL)" | newid)
    bad=""; refuses e2_$tier || bad="$bad not-refused"
    quiet_then_apply e2_$tier $L1 $o || bad="$bad no-apply"
    [ "$(q e2_$tier "SELECT count(*) FROM public.sessions WHERE user_id='$usr' AND status='active'")" = "0" ] || bad="$bad leftover-active"
    [ -z "$bad" ] && pass "[$tier] E2: live lease still preparing + an old take in its window — REFUSED untouched (L never attached to O); applies when quiet" || fail "[$tier] E2:$bad"
    # F — live L with ONLY older legacy takes (all before L started): not ambiguous. Applies; legacy fenced; L kept.
    premig ff_$tier
    o=$(q ff_$tier "$(as_user $usr) $(START_SQL)" | newid); q ff_$tier "UPDATE public.sessions SET created_at = now() - interval '2 minutes' WHERE id='$o'" >/dev/null
    q ff_$tier "$(as_user $usr) SELECT public.acquire_recording_lease('$L1','new frontend',false);" >/dev/null
    bad=""; qf ff_$tier "$M/20260923120000_one_active_engine_per_account_1476.sql" || bad="$bad refused"
    [ "$(state ff_$tier $o)" = "$o/displaced" ] || bad="$bad legacy=$(state ff_$tier $o)"
    [ "$(q ff_$tier "SELECT lease_id FROM public.active_recording_lease WHERE user_id='$usr'")" = "$L1" ] || bad="$bad holder-lost"
    [ -z "$bad" ] && pass "[$tier] F: live lease + only OLDER legacy takes — applies; the legacy take is fenced (may save); the live holder is kept" || fail "[$tier] F:$bad"
    # C — legacy only, stale holder: no fresh lease; the newest legacy take becomes the implicit holder; older fenced.
    premig c_$tier
    q c_$tier "$(as_user $usr) SELECT public.acquire_recording_lease('eeeeeeee-0000-4000-8000-0000000000c1','gone',false); UPDATE public.active_recording_lease SET heartbeat_at = now() - interval '5 minutes', started_at = now() - interval '10 minutes';" >/dev/null
    old=$(q c_$tier "$(as_user $usr) $(START_SQL)" | newid); q c_$tier "UPDATE public.sessions SET created_at = now() - interval '3 minutes' WHERE id='$old'" >/dev/null
    nw=$(q c_$tier "$(as_user $usr) $(START_SQL)" | newid); q c_$tier "UPDATE public.sessions SET created_at = now() - interval '2 minutes' WHERE id='$nw'" >/dev/null
    qf c_$tier "$M/20260923120000_one_active_engine_per_account_1476.sql"
    holder=$(q c_$tier "SELECT lease_id FROM public.active_recording_lease WHERE user_id='$usr'")
    [ "$holder" = "$nw" ] && [ "$(state c_$tier $nw)" = "$nw/unfenced" ] && [ "$(state c_$tier $old)" = "$old/displaced" ] && pass "[$tier] C: legacy only with a stale holder — the newest legacy take holds the implicit lease; the older is fenced" || fail "[$tier] C: holder=$holder newest=$(state c_$tier $nw) older=$(state c_$tier $old)"
  fi
  # D — barrier: the classification holds the account-lease table; a concurrent acquire from another connection waits
  # for the migration to commit, then sees the classified state — exactly one authorized take.
  premig d_$tier
  dleg=$(q d_$tier "$(as_user $usr) $(START_SQL)" | newid)
  ( psql -h /tmp -p "$PORT" -U postgres -d d_$tier -v ON_ERROR_STOP=1 -AtqX -c "BEGIN;" -f "$M/20260923120000_one_active_engine_per_account_1476.sql" -c "SELECT pg_sleep(3);" -c "COMMIT;" >/dev/null 2>&1 ) &
  mig=$!
  sleep 1.5
  lockmode=$(q d_$tier "SELECT string_agg(l.mode, ',') FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = 'active_recording_lease' AND l.granted AND l.pid <> pg_backend_pid()")
  t0=$(python3 -c 'import time; print(time.time())')
  dres=$(q d_$tier "$(as_user $usr) SELECT coalesce((public.acquire_recording_lease('eeeeeeee-0000-4000-8000-0000000000d9','X',false))->>'reason','acquired');" 2>&1 | tail -1 || true)
  waited=$(python3 -c "import time; print(round(time.time()-$t0,1))")
  wait $mig
  live=$(q d_$tier "SELECT count(*) FROM public.sessions WHERE user_id='$usr' AND status='active' AND recording_fenced_at IS NULL")
  echo "$lockmode" | grep -q ExclusiveLock && [ "$dres" = "held_by_other" ] && [ "$live" = "1" ] && python3 -c "import sys; sys.exit(0 if $waited >= 1.0 else 1)" \
    && pass "[$tier] D: the backfill holds the lease table (Exclusive); a concurrent PRE-migration acquire waited ${waited}s for the commit, then held_by_other — one authorized take" \
    || fail "[$tier] D: lock=[$lockmode] acquire=$dres waited=${waited}s live=$live"
done

# Case 8 — PM RETURN on 54576db9: an OLD client and a CURRENT client race on an EMPTY account, on separate connections,
# in both commit orders, Free and Pro. "Authorized" = told it may run an engine: the current client's acquire returned
# acquired:true, or the old client's create returned a session. Exactly one party may be authorized, and the lease row
# must belong to that party.
race8() {  # $1 user, $2 tier label, $3 order: current_first | old_first
  local usr=$1 tier=$2 order=$3 L=aaaaaaaa-0000-4000-8000-0000000000e1 a b holder
  reset
  if [ "$order" = current_first ]; then
    ( psql -h /tmp -p "$PORT" -U postgres -d fence -AtqX -c "$(as_user $usr) BEGIN; SELECT (public.acquire_recording_lease('$L','current',false))->>'acquired'; SELECT pg_sleep(1); COMMIT;" >/tmp/race8-cur.out 2>&1 || true ) &
    sleep 0.3
    ( psql -h /tmp -p "$PORT" -U postgres -d fence -AtqX -c "$(as_user $usr) $(START_SQL)" >/tmp/race8-old.out 2>&1 || true ) &
  else
    ( psql -h /tmp -p "$PORT" -U postgres -d fence -AtqX -c "$(as_user $usr) BEGIN; $(START_SQL) SELECT pg_sleep(1); COMMIT;" >/tmp/race8-old.out 2>&1 || true ) &
    sleep 0.3
    ( psql -h /tmp -p "$PORT" -U postgres -d fence -AtqX -c "$(as_user $usr) BEGIN; SELECT (public.acquire_recording_lease('$L','current',false))->>'acquired'; COMMIT;" >/tmp/race8-cur.out 2>&1 || true ) &
  fi
  wait
  a=$(grep -xc 'true' /tmp/race8-cur.out || true)
  b=$(grep -c '"new_session": {' /tmp/race8-old.out || true)
  holder=$(q fence "SELECT CASE WHEN lease_id='$L' THEN 'current' ELSE 'old' END FROM public.active_recording_lease WHERE user_id='$usr'" | tail -1)
  if [ "$a" = "1" ]; then q fence "$(as_user $usr) $(START_SQL $L)" >/dev/null 2>&1 || true; fi
  n=$(active_takes $usr)
  local owner=none; [ "$a" = "1" ] && owner=current; [ "$b" = "1" ] && owner=old
  if [ $((a + b)) = "1" ] && [ "$n" = "1" ] && [ "$holder" = "$owner" ]; then
    pass "[$tier/$order] old vs current client on an empty account: exactly one authorized (current=$a old=$b holder=$holder active=$n)"
  else
    fail "[$tier/$order] old vs current race: current=$a old=$b holder=$holder active=$n"
  fi
}
for T in "pro:$U" "free:$FR"; do for ORD in current_first old_first; do race8 "${T#*:}" "${T%%:*}" "$ORD"; done; done

# Case 9 — PM RETURN on 039043877 (F1): DISPLACEMENT IS PERMANENT. Take A is taken over by B; B then ends (release, or its
# lease goes stale) and C starts. A must never record or accrue again — heartbeat, direct write, or a heartbeat-shaped
# accrual transaction — while it may still be SAVED, its save RETRIED, or DISCARDED. Old and current clients, Free and Pro.
f1case() {  # $1 user $2 tier $3 old|current $4 release|stale $5 save|discard
  local usr=$1 tier=$2 kind=$3 ending=$4 finish=$5 A LA=aaaaaaaa-0000-4000-8000-0000000000f1 LB=bbbbbbbb-0000-4000-8000-0000000000f1 LC=cccccccc-0000-4000-8000-0000000000f1 bad=""
  reset
  if [ "$kind" = old ]; then
    A=$(q fence "$(as_user $usr) $(START_SQL)" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
  else
    A=$(q fence "$(as_user $usr) SELECT public.acquire_recording_lease('$LA','A',false); $(START_SQL $LA)" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
  fi
  q fence "$(as_user $usr) SELECT public.acquire_recording_lease('$LB','B',true);" >/dev/null
  q fence "$(as_user $usr) UPDATE public.sessions SET duration = 30 WHERE id='$A';" >/dev/null 2>&1 && bad="$bad hb-while-B"
  if [ "$ending" = release ]; then q fence "$(as_user $usr) SELECT public.release_recording_lease('$LB');" >/dev/null
  else q fence "UPDATE public.active_recording_lease SET heartbeat_at = now() - interval '20 seconds' WHERE lease_id='$LB';" >/dev/null; fi
  q fence "$(as_user $usr) UPDATE public.sessions SET duration = 60 WHERE id='$A';" >/dev/null 2>&1 && bad="$bad hb-after-B-$ending"
  q fence "$(as_user $usr) BEGIN; INSERT INTO public.usage_checkpoints (session_id,user_id,incremental_seconds,engine_type) VALUES ('$A','$usr',30,'private'); UPDATE public.sessions SET duration = 90 WHERE id='$A'; COMMIT;" >/dev/null 2>&1 && bad="$bad accrual"
  [ "$(q fence "SELECT count(*) FROM public.usage_checkpoints WHERE session_id='$A' AND incremental_seconds=30")" = "0" ] || bad="$bad usage-accrued"
  q fence "$(as_user $usr) SELECT public.acquire_recording_lease('$LC','C',false); $(START_SQL $LC)" >/dev/null 2>&1 || bad="$bad C-start"
  q fence "$(as_user $usr) UPDATE public.sessions SET duration = 120 WHERE id='$A';" >/dev/null 2>&1 && bad="$bad hb-while-C"
  q fence "$(as_user $usr) UPDATE public.sessions SET recording_fenced_at = NULL, recording_fenced_reason = NULL WHERE id='$A';" >/dev/null 2>&1 && bad="$bad fence-cleared"
  if [ "$finish" = save ]; then
    q fence "$(as_user $usr) UPDATE public.sessions SET status='completed', duration=45, transcript='what A captured' WHERE id='$A';" >/dev/null 2>&1 || bad="$bad save"
    q fence "$(as_user $usr) UPDATE public.sessions SET transcript='what A captured', updated_at=now() WHERE id='$A';" >/dev/null 2>&1 || bad="$bad retry-save"
    [ "$(q fence "SELECT status FROM public.sessions WHERE id='$A'")" = "completed" ] || bad="$bad not-saved"
    # A saved, displaced take can never RESUME — not by reopening it, and not by clearing its fence mark in the same write.
    q fence "$(as_user $usr) UPDATE public.sessions SET status='active' WHERE id='$A';" >/dev/null 2>&1 && bad="$bad resumed"
    q fence "$(as_user $usr) UPDATE public.sessions SET status='active', recording_fenced_at=NULL, recording_fenced_reason=NULL WHERE id='$A';" >/dev/null 2>&1 && bad="$bad resumed-by-clearing"
    # Two-step: clear the mark on the saved row first, then reopen it once it no longer looks fenced.
    q fence "$(as_user $usr) UPDATE public.sessions SET recording_fenced_at=NULL, recording_fenced_reason=NULL WHERE id='$A';" >/dev/null 2>&1 && bad="$bad fence-cleared-after-save"
    q fence "$(as_user $usr) UPDATE public.sessions SET status='active' WHERE id='$A';" >/dev/null 2>&1 && bad="$bad resumed-after-clearing"
  else
    q fence "$(as_user $usr) UPDATE public.sessions SET status='failed' WHERE id='$A';" >/dev/null 2>&1 || bad="$bad discard"
  fi
  [ "$(active_takes $usr)" = "1" ] || bad="$bad active=$(active_takes $usr)"
  [ -z "$bad" ] && pass "[$tier/$kind/B-$ending/$finish] displaced take stays fenced after its successor ends; C records; A's $finish lands" || fail "[$tier/$kind/B-$ending/$finish]:$bad"
}
# An OLD client's Start that takes over a STALE lease (the writer's legacy path) displaces that holder permanently too.
f1legacy() {  # $1 user $2 tier
  local usr=$1 tier=$2 A C LA=aaaaaaaa-0000-4000-8000-0000000000f7 bad=""
  reset
  A=$(q fence "$(as_user $usr) SELECT public.acquire_recording_lease('$LA','A',false); $(START_SQL $LA)" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
  q fence "UPDATE public.active_recording_lease SET heartbeat_at = now() - interval '20 seconds' WHERE lease_id='$LA';" >/dev/null   # A's device went quiet
  C=$(q fence "$(as_user $usr) $(START_SQL)" | tail -1 | python3 -c 'import sys,json; print((json.loads(sys.stdin.read()).get("new_session") or {}).get("id",""))')
  [ -n "$C" ] || bad="$bad old-client-start-refused"
  q fence "$(as_user $usr) UPDATE public.sessions SET status='completed' WHERE id='$C';" >/dev/null   # C ends (its implicit lease is released)
  q fence "$(as_user $usr) UPDATE public.sessions SET duration = 60 WHERE id='$A';" >/dev/null 2>&1 && bad="$bad A-revived"
  q fence "$(as_user $usr) UPDATE public.sessions SET status='completed', duration=40 WHERE id='$A';" >/dev/null 2>&1 || bad="$bad A-save"
  [ -z "$bad" ] && pass "[$tier] an old client taking over a stale lease displaces its holder permanently; the holder can still save" || fail "[$tier] legacy stale take-over:$bad"
}
f1legacy "$U" pro; f1legacy "$FR" free
for T in "pro:$U" "free:$FR"; do for K in old current; do for E in release stale; do f1case "${T#*:}" "${T%%:*}" $K $E save; done; done; done
f1case "$U" pro old release discard; f1case "$FR" free current stale discard

# Case 10 — PM RETURN on 039043877 (F2): RETRY SAVE OF A TAKE WHOSE ROW NEVER EXISTED claims no recording slot. Created
# save-only (never able to record) under the ORIGINAL recording identity and duration, while another device records.
SAVE_SQL() { echo "SELECT public.create_session_and_update_usage('{\"title\":\"recovered\",\"duration\":93,\"total_words\":0,\"save_only\":true}'::jsonb,'private',$1);"; }
f2case() {  # $1 user $2 tier
  local usr=$1 tier=$2 K="'dddddddd-0000-4000-8000-0000000000d1'::uuid" LB=bbbbbbbb-0000-4000-8000-0000000000d1 LC=cccccccc-0000-4000-8000-0000000000d1 R R2 bad="" out
  reset; q fence "DELETE FROM public.usage_checkpoints" >/dev/null
  q fence "$(as_user $usr) SELECT public.acquire_recording_lease('$LB','B',false); $(START_SQL $LB)" >/dev/null   # device B records
  out=$(q fence "$(as_user $usr) $(SAVE_SQL "$K")" 2>&1 | tail -1 || true)   # an SQL error must report, not abort the run
  R=$(echo "$out" | python3 -c 'import sys,json; d=json.loads(sys.stdin.read()); print((d.get("new_session") or {}).get("id",""))' 2>/dev/null || true)
  if [ -z "$R" ]; then fail "[$tier] save-only recovery while B records: refused ($out)"; return; fi
  [ "$(q fence "SELECT status||'/'||coalesce(lease_id::text,'none')||'/'||coalesce(recording_fenced_reason,'unfenced')||'/'||duration FROM public.sessions WHERE id='$R'" 2>/dev/null)" = "active/none/save_only/93" ] || bad="$bad row-shape"
  [ "$(q fence "SELECT lease_id FROM public.active_recording_lease WHERE user_id='$usr'")" = "$LB" ] || bad="$bad took-B-lease"
  [ "$(q fence "SELECT coalesce(sum(incremental_seconds),0) FROM public.usage_checkpoints WHERE session_id='$R'")" = "93" ] || bad="$bad not-billed"
  R2=$(q fence "$(as_user $usr) $(SAVE_SQL "$K")" | tail -1 | python3 -c 'import sys,json; d=json.loads(sys.stdin.read()); print(d["new_session"]["id"], d.get("is_duplicate"))' 2>/dev/null || true)
  [ "$R2" = "$R True" ] || bad="$bad replay=$R2"
  [ "$(q fence "SELECT coalesce(sum(incremental_seconds),0) FROM public.usage_checkpoints WHERE session_id='$R'")" = "93" ] || bad="$bad double-billed"
  q fence "$(as_user $usr) UPDATE public.sessions SET duration = 120 WHERE id='$R';" >/dev/null 2>&1 && bad="$bad heartbeat"
  q fence "$(as_user $usr) SELECT public.create_session_and_update_usage('{\"title\":\"x\",\"duration\":93,\"total_words\":0,\"save_only\":true}'::jsonb,'private',NULL);" 2>/dev/null | tail -1 | grep -q '"new_session": {' && bad="$bad no-identity-accepted"
  q fence "$(as_user $usr) SELECT public.release_recording_lease('$LB'); UPDATE public.sessions SET status='completed' WHERE lease_id='$LB';" >/dev/null   # B stops (and saves); C starts while R is still unsaved
  q fence "$(as_user $usr) SELECT public.acquire_recording_lease('$LC','C',false); $(START_SQL $LC)" 2>/dev/null | tail -1 | grep -q '"new_session": {' || bad="$bad C-blocked-by-recovery"
  out=$(set +o pipefail; q fence "$(as_user $usr) SELECT public.complete_session_v2('$R','completed',93,NULL,'{\"type\":\"practice\"}'::jsonb,12,0.8,110,'{}'::jsonb,NULL,'the recovered words');" 2>&1 | tail -1)
  if [ "$tier" = pro ]; then
    echo "$out" | grep -q '"final_status": "completed"' || bad="$bad complete($out)"
    [ "$(q fence "SELECT status||'/'||duration||'/'||coalesce(transcript_state,'?') FROM public.sessions WHERE id='$R'")" = "completed/93/available" ] || bad="$bad saved-shape"
  else
    # Entitlement is not bypassed: completion applies the SAME tier rule it applies to any take (a Free account
    # without a trial is refused), and the save-only row stays unable to record.
    echo "$out" | grep -q '"error": "trial_expired"' || bad="$bad free-completion($out)"
  fi
  q fence "$(as_user $usr) UPDATE public.sessions SET duration = 600, status='completed' WHERE id='$R';" >/dev/null 2>&1 && bad="$bad saved-more-than-billed"
  [ "$(q fence "SELECT count(*) FROM public.sessions WHERE user_id='$usr' AND status='active' AND recording_fenced_at IS NULL")" = "1" ] || bad="$bad recording-rows=$(q fence "SELECT count(*) FROM public.sessions WHERE user_id='$usr' AND status='active' AND recording_fenced_at IS NULL")"
  [ -z "$bad" ] && pass "[$tier] missing-row Retry Save while another device records: save-only row, original identity+duration billed once, no lease, no heartbeat, no slot; completes via complete_session_v2" || fail "[$tier] save-only recovery:$bad"
}
f2case "$U" pro; f2case "$FR" free
# Ownership: another account presenting the same recording identity never reaches this account's row.
reset
own=$(q fence "$(as_user $U) $(SAVE_SQL "'dddddddd-0000-4000-8000-0000000000d2'::uuid")" | tail -1 | python3 -c 'import sys,json; print(json.loads(sys.stdin.read())["new_session"]["id"])')
other=$(q fence "$(as_user $O) $(SAVE_SQL "'dddddddd-0000-4000-8000-0000000000d2'::uuid")" 2>/dev/null | tail -1 | python3 -c 'import sys,json; d=json.loads(sys.stdin.read()); print((d.get("new_session") or {}).get("id",""), (d.get("new_session") or {}).get("user_id",""))' 2>/dev/null || echo "refused")
case "$other" in "$own"*) fail "save-only ownership: another account received this account's row";; *) pass "save-only ownership: the same recording identity from another account never returns this account's row ($other)";; esac

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
# Writer dependencies the shared attribution bootstrap does not carry (production has them), so the #1476 writer's
# save-only recovery path can run here against the attribution + Progress chain.
q progress "CREATE TABLE IF NOT EXISTS public.user_profiles (id uuid PRIMARY KEY, subscription_status text, trial_expires_at timestamptz, stripe_subscription_id text, subscription_id text, commercial_trial_granted_at timestamptz); INSERT INTO public.user_profiles (id, subscription_status) VALUES ('$U','pro') ON CONFLICT DO NOTHING; CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text, timestamptz, text, text, timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS \$fn\$ SELECT CASE WHEN \$1 = 'pro' THEN 'pro' ELSE 'free' END \$fn\$; CREATE TABLE IF NOT EXISTS public.usage_checkpoints (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid, user_id uuid, incremental_seconds int, engine_type text, created_at timestamptz DEFAULT now()); CREATE OR REPLACE FUNCTION public.update_user_usage(int, text, uuid) RETURNS jsonb LANGUAGE sql AS \$fn\$ SELECT jsonb_build_object('success', true) \$fn\$; ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS idempotency_key uuid;" >/dev/null
L=aaaaaaaa-0000-4000-8000-000000000008
sid=$(q progress "$(as_user $U) SELECT public.acquire_recording_lease('$L','dev',false); INSERT INTO public.sessions (user_id,status,duration,total_words,wpm,transcript,engine,engine_version,model_name,device_type,attribution_status,filler_counts,lease_id) VALUES ('$U','active',93,141,91,'a clean transcript with plenty of ordinary words','private','private_v2:whisper-base.en','whisper-base.en','browser','pending','{\"um\":2}'::jsonb,'$L') RETURNING id;" | tail -1)
q progress "SET ROLE service_role; SELECT public.issue_attribution_intent_v1('$U','rec-$sid','private','base'); SELECT public.bind_attribution_intent_v1('$sid','rec-$sid'); UPDATE public.sessions SET status='completed' WHERE id='$sid'; SELECT public.attest_session_engine_v1('$sid','{\"provider\":\"transformers-js\",\"model_id\":\"base\",\"fallback_occurred\":false,\"cloud_used\":false}'::jsonb); RESET ROLE;" >/dev/null
owed=$(q progress "$(as_user $U) SELECT public.get_progress_obligations()->0->>'state';" | tail -1)
[ "$owed" = "owed" ] && pass "after both migrations, a completed attested take is listed as owed" || fail "obligation state: $owed"
evid=$(q progress "$(as_user $U) SELECT public.record_progress_evaluation('$sid');" | tail -1)
left=$(q progress "$(as_user $U) SELECT jsonb_array_length(public.get_progress_obligations());" | tail -1)
[ -n "$evid" ] && [ "$left" = "0" ] && pass "#1521's evaluator settles it and the obligation clears (evaluation $evid)" || fail "settle after #1521: eval=$evid left=$left"

# Case 12 — PM RETURN on 039043877 (F2): a recovered (save-only) row owes Progress exactly like any completed take, and
# #1521's evaluator settles it.
rec=$(q progress "$(as_user $U) SELECT public.create_session_and_update_usage('{\"title\":\"recovered\",\"duration\":93,\"total_words\":141,\"save_only\":true}'::jsonb,'private','eeeeeeee-0000-4000-8000-0000000000e2'::uuid);" 2>&1 | tail -1 | python3 -c 'import sys,json; print((json.loads(sys.stdin.read()).get("new_session") or {}).get("id",""))' 2>/dev/null || true)
if [ -n "$rec" ]; then
  q progress "SET ROLE service_role; UPDATE public.sessions SET status='completed', wpm=91, transcript='a recovered transcript with plenty of ordinary words', filler_counts='{\"um\":2}'::jsonb WHERE id='$rec'; SELECT public.resolve_session_unattributed_v1('$rec'); RESET ROLE;" >/dev/null
  st=$(q progress "$(as_user $U) SELECT e->>'state' FROM jsonb_array_elements(public.get_progress_obligations()) e WHERE e->>'session_id'='$rec';" | tail -1)
  ev=$(q progress "$(as_user $U) SELECT public.record_progress_evaluation('$rec');" 2>/dev/null | tail -1 || true)
  st2=$(q progress "$(as_user $U) SELECT count(*) FROM jsonb_array_elements(public.get_progress_obligations()) e WHERE e->>'session_id'='$rec';" | tail -1)
  [ "$st" = "owed" ] && [ -n "$ev" ] && [ "$st2" = "0" ] && pass "save-only recovered row: listed as owed Progress, and #1521's evaluator settles it (evaluation $ev)" || fail "recovered row Progress: state=$st eval=$ev left=$st2"
else
  fail "recovered row Progress: save-only create refused"
fi

echo "SUMMARY fails=$FAILS"
[ "$FAILS" = "0" ]
