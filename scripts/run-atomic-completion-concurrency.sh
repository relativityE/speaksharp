#!/usr/bin/env bash
# #1314 RETURN 4 — real multi-connection contention proof for the atomic completion RPC.
#
# PGlite is single-connection, so contention could previously only be argued structurally. This opens TWO real
# backends that race to complete sessions for the SAME user and asserts the outcome, using the psql +
# service-container pattern the repo already uses for its other real-Postgres matrices.
#
# Requires: psql on PATH and PG* env vars (or a running local cluster). Exits non-zero on any failed assertion.
set -euo pipefail

PSQL="psql -v ON_ERROR_STOP=1 -qAt"
U='11111111-1111-4111-8111-111111111111'
M=backend/supabase/migrations
BOOTSTRAP="tests/db/transcript-retention-converge-bootstrap.sql"
M1131="$M/20260801000000_sessions_transcript_state.sql"
R1="$M/20260803000000_transcript_retention_newest_two.sql"
R2="$M/20260804000000_transcript_retention_converge_on_save.sql"
MIG_A="$M/20260816223606_metrics_only_additive_1306.sql"
MIG_B="$M/20260819120000_complete_session_v2_atomic_retention_1314.sql"
REC='{"reasonCode":"HIGH_FILLER_RATE","actionCode":"REDUCE_FILLERS","metric":"filler_rate","value":0.08,"comparator":"above_baseline","templateVersion":"rec_v1"}'

echo "== install the REAL migration chain (no stand-in coordinator) =="
# Reset first so the harness is re-runnable against a reused database.
$PSQL -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
          DROP SCHEMA IF EXISTS auth CASCADE;" >/dev/null
for f in "$BOOTSTRAP" "$M1131" "$R1" "$R2" tests/db/atomic-completion-concurrency-realpg.sql "$MIG_A" "$MIG_B"; do
  echo "   -- $f"
  $PSQL -f "$f" >/dev/null
done
# converge_transcript_retention is now the ACTUAL R1/R2 coordinator. Observe its entries without changing it.
$PSQL -c "CREATE OR REPLACE FUNCTION public.converge_transcript_retention_observed(p_user_id uuid)
          RETURNS jsonb LANGUAGE plpgsql AS \$fn\$
          BEGIN
            INSERT INTO public.retention_calls (called_for) VALUES (p_user_id);
            RETURN public.converge_transcript_retention(p_user_id);
          END \$fn\$;" >/dev/null

$PSQL -c "INSERT INTO auth.users(id) VALUES ('$U') ON CONFLICT DO NOTHING;
          INSERT INTO public.user_profiles(id, subscription_status) VALUES ('$U','pro') ON CONFLICT DO NOTHING;" >/dev/null

seed() { # $1 = suffix, $2 = day
  $PSQL -c "INSERT INTO public.sessions(id,user_id,created_at,status,duration)
            VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-$(printf '%012d' "$1")','$U',
                    '2026-07-$(printf '%02d' "$2")T10:00:00Z','active',0);" >/dev/null
  printf 'aaaaaaaa-aaaa-4aaa-8aaa-%012d' "$1"
}

finish() { # $1 = session id, $2 = transcript
  $PSQL -c "SELECT set_config('request.jwt.claim.sub','$U',false);
            SELECT public.complete_session_v2(
              p_session_id => '$1'::uuid, p_status => 'completed', p_final_duration => 60, p_reason => NULL,
              p_next_action => '$REC'::jsonb, p_total_words => 100, p_clarity_score => 80, p_wpm => 120,
              p_filler_counts => '{}'::jsonb, p_pause_metrics => NULL, p_final_transcript => '$2');"
}

retained() { $PSQL -c "SELECT count(*) FROM public.sessions WHERE user_id='$U' AND transcript_state='available';"; }

# Option A (R1/R2): the REAL coordinator NEVER expires a candidate whose terminal Progress evaluation is not yet
# durable — it defers and reports `pending`. Without this, nothing rotates and the harness measures nothing.
# The earlier simplified stub expired unconditionally, i.e. it exercised a policy the product does not implement.
evidence() { # $1 = session id
  $PSQL -c "INSERT INTO public.session_progress_evaluations
              (user_id, session_id, formula_version, attribution_status, eligible)
            VALUES ('$U','$1','clarity_v1','verified',true)
            ON CONFLICT DO NOTHING;" >/dev/null
}

echo "== seed two already-retained sessions =="
S1=$(seed 1 1); S2=$(seed 2 2)
finish "$S1" 'synthetic one' >/dev/null
finish "$S2" 'synthetic two' >/dev/null
[ "$(retained)" = "2" ] || { echo "SETUP FAIL: expected 2 retained, got $(retained)"; exit 1; }

echo "== record durable terminal evidence so Option A permits rotation =="
evidence "$S1"; evidence "$S2"

echo "== RACE: two concurrent backends complete two more sessions for the same user =="
S3=$(seed 3 3); S4=$(seed 4 4)
# Prove the two backends genuinely OVERLAP in wall clock. Without this the "contention" proof could pass on two
# sequential calls, which is the trap the previous stub-based version fell into. Timing is recorded around each
# real backend rather than inside the coordinator, so the shipped retention logic is untouched.
race() { # $1 = session id, $2 = transcript, $3 = tag
  date +%s.%N > "/tmp/${3}.start"
  finish "$1" "$2" > "/tmp/${3}.out" 2>&1
  local rc=$?
  date +%s.%N > "/tmp/${3}.end"
  return $rc
}
race "$S3" 'synthetic three' A &
P3=$!
race "$S4" 'synthetic four'  B &
P4=$!
set +e; wait $P3; R3=$?; wait $P4; R4=$?; set -e

echo "-- backend A rc=$R3 / backend B rc=$R4"
[ "$R3" -eq 0 ] && [ "$R4" -eq 0 ] || { echo "FAIL: a concurrent completion errored"; cat /tmp/race3.out /tmp/race4.out; exit 1; }

FINAL=$(retained)
echo "-- retained transcripts after the race: $FINAL"

# THE INVARIANT: concurrent completions must not interleave past the per-user lock and leave a third transcript.
if [ "$FINAL" != "2" ]; then
  echo "FAIL: at-most-two breached under contention (retained=$FINAL)"
  $PSQL -c "SELECT id, transcript_state FROM public.sessions WHERE user_id='$U' ORDER BY created_at;"
  exit 1
fi

# CONTENTION IS REAL: the two backends' execution intervals must overlap. If they did not, this proved nothing
# about concurrency — it would just be two sequential completions.
AS=$(cat /tmp/A.start); AE=$(cat /tmp/A.end); BS=$(cat /tmp/B.start); BE=$(cat /tmp/B.end)
echo "-- backend A [$AS .. $AE]"
echo "-- backend B [$BS .. $BE]"
awk -v as="$AS" -v ae="$AE" -v bs="$BS" -v be="$BE" 'BEGIN {
  ov = (as < be) && (bs < ae);
  if (!ov) { print "FAIL: the two backends did not overlap — this was not a race"; exit 1 }
  printf "-- overlap confirmed: %.3fs\n", (ae < be ? ae : be) - (as > bs ? as : bs);
}'

# Both sessions really were completed by the racing backends (neither silently no-opped).
DONE=$($PSQL -c "SELECT count(*) FROM public.sessions WHERE user_id='$U' AND status='completed';")
echo "-- completed sessions: $DONE"
[ "$DONE" -ge 4 ] || { echo "FAIL: expected >=4 completed sessions, got $DONE"; exit 1; }

echo "PASS: with the REAL R1/R2 coordinator, at-most-two held under genuinely overlapping multi-connection contention."
