#!/usr/bin/env bash
# Outcome 4 D2 rev 2 — concurrency proof for the practised-tip migration on a REAL PostgreSQL server.
# PGlite is single-connection, so interleaved transactions are proven here instead. NOT run in CI.
# Usage (disposable local server only, never a hosted database):
#   PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres tests/db/manual/repeat-practised-tip-concurrency.sh
# Each scenario gets a fresh database, applies the same files the PGlite suite applies (verbatim), and runs two
# psql sessions whose transactions overlap: the first holds its write open while the second starts.
# Production additionally serialises a user's saves with a NOWAIT lock on user_profiles; this omits that lock on
# purpose, so the migration is shown correct even when two writes for one user do overlap.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
M="$ROOT/backend/supabase/migrations"
U=11111111-1111-4111-8111-111111111111
A=aaaaaaaa-0000-4000-8000-00000000000a
B=aaaaaaaa-0000-4000-8000-00000000000b
C=aaaaaaaa-0000-4000-8000-00000000000c
TIP='Pause before you name the price.'
REVIEW="{\"version\":\"gemini_coaching_v1\",\"what_worked\":\"The opening was concrete.\",\"what_to_try_next\":\"$TIP\"}"
MIGRATION="${MIGRATION:-$M/20261112010000_repeat_practised_tip.sql}"
fail=0

q() { PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
as_user() { printf "SET request.jwt.claim.sub = '%s'; SET ROLE authenticated; %s" "$U" "$1"; }

setup() {
  DB="tip_conc_$1"
  PGOPTIONS="-c client_min_messages=warning" psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
  q -f "$ROOT/tests/db/progress-evaluations-bootstrap.sql" >/dev/null
  q -c "ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS ai_suggestions jsonb, ADD COLUMN IF NOT EXISTS transcript_state text" >/dev/null
  for f in "$M/20260731120000_session_progress_evaluations.sql" "$M/20260731130000_progress_recommendations.sql" \
           "$M/20260810120000_retention_purge_ai_suggestions.sql" "$MIGRATION"; do q -f "$f" >/dev/null; done
  q >/dev/null <<SQL
GRANT authenticated TO CURRENT_USER;
INSERT INTO auth.users (id) VALUES ('$U');
INSERT INTO public.sessions (id, user_id, total_words, duration, wpm, filler_words, transcript, engine, engine_version,
    model_name, attribution_status, status, created_at, ai_suggestions, transcript_state)
VALUES ('$A', '$U', 300, 120, 140, '{"um":{"count":6},"total":{"count":6}}', 'a transcript', 'private', 'whisper-base.en@v2',
    'whisper-base.en', 'verified', 'completed', now() - interval '1 hour', '$REVIEW'::jsonb, 'available');
SQL
  q -Atc "$(as_user "SELECT public.record_progress_evaluation('$A');")" >/dev/null
  REC=$(q -Atc "$(as_user "SELECT public.record_progress_recommendation('$A', 'filler_rate', 'decrease', 3, 'percent', 'Cut fillers');")" | tail -1)
  ATT=$(q -Atc "$(as_user "SELECT public.record_recommendation_attempt('$REC');")" | tail -1)
  # B then C start recording after Practice again.
  for s in "$B" "$C"; do
    q -c "INSERT INTO public.sessions (id, user_id, total_words, duration, wpm, filler_words, engine, engine_version, model_name,
          attribution_status, status, created_at, transcript_state) VALUES ('$s', '$U', 300, 120, 140,
          '{\"um\":{\"count\":2},\"total\":{\"count\":2}}', 'private', 'whisper-base.en@v2', 'whisper-base.en', 'verified',
          'active', clock_timestamp(), 'not_captured')" >/dev/null
  done
}
complete_sql() { echo "UPDATE public.sessions SET status = 'completed' WHERE id = '$1';"; }
result() { q -Atc "SELECT coalesce(practised_tip, '<none>') || ' | bound=' || coalesce(tip_session_id::text, '<none>') || ' | practice=' || coalesce(practice_session_id::text, '<none>') || ' | ' || lifecycle FROM public.progress_recommendation_attempts WHERE id = '$ATT'"; }
check() { local name="$1" want="$2" got; got="$(result)"; if [[ "$got" == "$want" ]]; then echo "PASS  $name: $got"; else echo "FAIL  $name: got [$got] want [$want]"; fail=1; fi; }
overlap() { # $1 = first txn body (held open 3 s), $2 = second txn body (starts 1 s later)
  q -c "BEGIN; $1 SELECT pg_sleep(3); COMMIT;" >/dev/null & local first=$!
  sleep 1
  q -c "BEGIN; $2 COMMIT;" >/dev/null
  wait $first
}

echo "1. Two saves overlap: B's save (binds B) is still open when the newer C saves."
setup s1; overlap "$(complete_sql "$B")" "$(complete_sql "$C")"
check "C supersedes B even though B's binding was uncommitted when C started" "<none> | bound=$B | practice=<none> | pending"

echo "2. The advance for B is still open when the newer C saves."
setup s2; q -c "$(complete_sql "$B")" >/dev/null
q -Atc "$(as_user "SELECT public.record_progress_evaluation('$B');")" >/dev/null
overlap "$(as_user "SELECT public.advance_recommendation_attempt('$ATT', 'not_comparable', '$B');")" "$(complete_sql "$C")"
check "C's save waits for the advance, then deletes the copy" "<none> | bound=$B | practice=$B | not_comparable"

echo "3. Delayed retry: C's save is still open when the late advance for B arrives."
setup s3; q -c "$(complete_sql "$B")" >/dev/null
q -Atc "$(as_user "SELECT public.record_progress_evaluation('$B');")" >/dev/null
overlap "$(complete_sql "$C")" "$(as_user "SELECT public.advance_recommendation_attempt('$ATT', 'not_comparable', '$B');")"
check "the late advance binds B and carries no tip" "<none> | bound=$B | practice=$B | not_comparable"

echo "4. Control: B saves and is advanced with nothing overlapping."
setup s4; q -c "$(complete_sql "$B")" >/dev/null
q -Atc "$(as_user "SELECT public.advance_recommendation_attempt('$ATT', 'abandoned');")" >/dev/null
check "abandon clears; binding kept" "<none> | bound=$B | practice=<none> | abandoned"
setup s5; q -c "$(complete_sql "$B")" >/dev/null
check "B alone keeps the tip" "$TIP | bound=$B | practice=<none> | pending"

for s in s1 s2 s3 s4 s5; do PGOPTIONS="-c client_min_messages=warning" psql -X -q -d postgres -c "DROP DATABASE IF EXISTS tip_conc_$s"; done
exit $fail
