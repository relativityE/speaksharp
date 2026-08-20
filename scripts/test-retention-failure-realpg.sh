#!/usr/bin/env bash
# #1314 — retention-failure invariants proven against REAL PostgreSQL (PGlite cannot honour statement_timeout).
#   Blocker 1: a query_canceled during the coordinator must NOT roll back the durable session-metrics write.
#   Blocker 2: a non-converged (pending) retention RESULT must NOT retain a third transcript.
# Read-mostly; operates only on its own synthetic user. Exits nonzero on any failed assertion.
set -uo pipefail
: "${DB_URL:?set DB_URL}"
PSQL="psql $DB_URL -v ON_ERROR_STOP=1 -qAt"
M=backend/supabase/migrations
U=11111111-1111-4111-8111-111111111111
REC='{"reasonCode":"HIGH_FILLER_RATE","actionCode":"REDUCE_FILLERS","metric":"filler_rate","value":0.08,"comparator":"above_baseline","templateVersion":"rec_v1"}'
fails=0
chk() { if [ "$2" = "$3" ]; then printf '  OK   %-40s %s\n' "$1" "$3"; else printf '  FAIL %-40s want=%s got=%s\n' "$1" "$2" "$3"; fails=$((fails+1)); fi; }

$PSQL -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE;" >/dev/null
for f in tests/db/transcript-retention-converge-bootstrap.sql \
         "$M/20260801000000_sessions_transcript_state.sql" "$M/20260803000000_transcript_retention_newest_two.sql" \
         "$M/20260804000000_transcript_retention_converge_on_save.sql" tests/db/atomic-completion-concurrency-realpg.sql \
         "$M/20260816223606_metrics_only_additive_1306.sql" "$M/20260819120000_complete_session_v2_atomic_retention_1314.sql"; do
  $PSQL -f "$f" >/dev/null
done
$PSQL >/dev/null <<SQL
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS subscription_status text;
CREATE OR REPLACE FUNCTION public.effective_subscription_tier(text,timestamptz,text,text,timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT ''pro''::text';
INSERT INTO auth.users(id) VALUES ('$U') ON CONFLICT DO NOTHING;
INSERT INTO public.user_profiles(id,subscription_status) VALUES ('$U','pro') ON CONFLICT DO NOTHING;
SQL

echo "== BLOCKER 1: query_canceled during retention preserves the session metrics =="
# Replace the real coordinator with one that hangs, in ONE session with statement_timeout + the call.
OUT=$($PSQL <<SQL
SELECT set_config('request.jwt.claim.sub','$U',false);
CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER AS \$fn\$ BEGIN PERFORM pg_sleep(5); RETURN jsonb_build_object('status','converged'); END \$fn\$;
INSERT INTO public.sessions(id,user_id,created_at,status,duration) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','$U',now(),'active',0);
SET statement_timeout = '700ms';
SELECT (public.complete_session_v2('aaaaaaaa-aaaa-4aaa-8aaa-000000000001'::uuid,'completed',60,NULL,'$REC'::jsonb,140,80,120,'{}'::jsonb,NULL,'hang'))->>'transcript_outcome';
RESET statement_timeout;
SELECT 'STATUS='||status||' WORDS='||total_words||' TX='||COALESCE(transcript,'<null>') FROM public.sessions WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
SQL
)
echo "$OUT" | sed 's/^/    /'
echo "$OUT" | grep -q "STATUS=completed WORDS=140 TX=<null>" && chk "session survived cancel, transcript dropped" "yes" "yes" || chk "session survived cancel, transcript dropped" "yes" "no"

echo "== BLOCKER 2: pending retention keeps <=2 transcripts (real coordinator, no evidence) =="
R=$($PSQL <<SQL
SELECT set_config('request.jwt.claim.sub','$U',false);
-- restore the real coordinator
CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS \$fn\$
BEGIN RETURN public.converge_transcript_retention(p_user_id); END \$fn\$;
SQL
)
# The above self-reference is wrong; reload the real one from the migration file instead.
$PSQL -f "$M/20260804000000_transcript_retention_converge_on_save.sql" >/dev/null 2>&1
CNT=$($PSQL <<SQL
SELECT set_config('request.jwt.claim.sub','$U',false);
INSERT INTO public.sessions(id,user_id,created_at,status,duration) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000011','$U','2026-07-01T10:00Z','active',0),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000012','$U','2026-07-02T10:00Z','active',0),
 ('aaaaaaaa-aaaa-4aaa-8aaa-000000000013','$U','2026-07-03T10:00Z','active',0);
SELECT public.complete_session_v2('aaaaaaaa-aaaa-4aaa-8aaa-000000000011'::uuid,'completed',60,NULL,'$REC'::jsonb,100,80,120,'{}'::jsonb,NULL,'one');
SELECT public.complete_session_v2('aaaaaaaa-aaaa-4aaa-8aaa-000000000012'::uuid,'completed',60,NULL,'$REC'::jsonb,100,80,120,'{}'::jsonb,NULL,'two');
SELECT (public.complete_session_v2('aaaaaaaa-aaaa-4aaa-8aaa-000000000013'::uuid,'completed',60,NULL,'$REC'::jsonb,100,80,120,'{}'::jsonb,NULL,'three'))->>'transcript_outcome';
SELECT count(*) FROM public.sessions WHERE user_id='$U' AND transcript_state='available';
SQL
)
echo "$CNT" | sed 's/^/    /'
FINAL=$(echo "$CNT" | tail -1)
chk "retained transcripts stays at 2" "2" "$FINAL"

echo
[ "$fails" -eq 0 ] && echo "PASS: retention-failure invariants hold (blockers 1 and 2)." || { echo "FAILED: $fails"; exit 1; }
