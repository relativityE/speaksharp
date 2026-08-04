#!/usr/bin/env bash
# #1117 R2 — real-PostgreSQL proof that BOTH live transcript writers enforce retention (no bypass).
# Drives the ACTUAL create_session_and_update_usage and complete_session RPCs (not the coordinator directly)
# and asserts each returns a content-free `retention` status AND that convergence actually occurs. No Docker;
# no hosted DB. Content-free.
set -euo pipefail
PGBIN=/opt/homebrew/opt/postgresql@17/bin
WT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$WT/backend/supabase/migrations"
BOOT="$WT/tests/db/transcript-retention-concurrency-realpg-bootstrap.sql"
ROOT="$(mktemp -d /tmp/r2pgw.XXXXXX)"; PORT=5435
export LC_ALL=C LANG=C
U='22222222-2222-4222-8222-222222222222'
sid() { printf 'bbbbbbbb-bbbb-4bbb-8bbb-%012d' "$1"; }
cleanup() { "$PGBIN/pg_ctl" -D "$ROOT/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$ROOT"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$ROOT/data" -U postgres --auth=trust >/dev/null 2>&1
"$PGBIN/pg_ctl" -D "$ROOT/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -k /tmp -c lc_messages=C" -w -l "$ROOT/log" start >/dev/null 2>&1
"$PGBIN/createdb" -h 127.0.0.1 -p $PORT -U postgres r2 >/dev/null 2>&1
P() { psql -h 127.0.0.1 -p $PORT -U postgres -d r2 -v ON_ERROR_STOP=1 "$@"; }

P -q -f "$BOOT"
P -q -f "$MIG/20260801000000_sessions_transcript_state.sql"
P -q -f "$MIG/20260803000000_transcript_retention_newest_two.sql"
P -q -f "$MIG/20260804000000_transcript_retention_converge_on_save.sql"

P -q -c "INSERT INTO auth.users(id) VALUES ('$U');"
P -q -c "INSERT INTO public.user_profiles(id, subscription_status) VALUES ('$U','free');"
# Two older transcript-bearing sessions WITH durable terminal evidence (2 sessions => no candidate yet).
for k in 1 2; do
  P -q -c "INSERT INTO public.sessions(id,user_id,created_at,transcript,total_words,duration,status)
           VALUES ('$(sid "$k")','$U', timestamptz '2026-07-0${k} 10:00:00Z','t${k}',100,60,'completed');"
  P -q -c "INSERT INTO public.session_progress_evaluations(user_id,session_id,formula_version,attribution_status,eligible)
           VALUES ('$U','$(sid "$k")','clarity_v1','verified',true);"
done

FAILED=0
# WRITER 1: create_session_and_update_usage — a new (newest) transcript-bearing session via the REAL RPC.
CREATE_JSON=$(P -qtAc "SELECT set_config('request.jwt.claim.sub','$U',false);
  SELECT public.create_session_and_update_usage(
    jsonb_build_object('title','c','duration',60,'total_words',100,'transcript','t3-newest'),
    'private', NULL, NULL, NULL, NULL);" | tail -1)
echo "create_session response has retention key: $(echo "$CREATE_JSON" | grep -c retention)"
echo "$CREATE_JSON" | grep -q '"retention"' || { echo "FAIL: create_session_and_update_usage did NOT enforce (no retention key)"; FAILED=1; }
# Now 3 transcript-bearing; oldest (sid 1, durable evidence) must have expired.
S1=$(P -qtAc "SELECT transcript_state FROM public.sessions WHERE id='$(sid 1)';")
[ "$S1" = "expired" ] || { echo "FAIL: create path did not converge oldest candidate (sid1=$S1)"; FAILED=1; }

# WRITER 2: complete_session — finalize a freshly-created ACTIVE session with a final transcript via REAL RPC.
NEWID=$(P -qtAc "SELECT set_config('request.jwt.claim.sub','$U',false);
  SELECT (public.create_session_and_update_usage(jsonb_build_object('title','a','duration',60,'total_words',100),'private',NULL,NULL,NULL,NULL)->'new_session'->>'id');" | tail -1)
COMPLETE_JSON=$(P -qtAc "SELECT set_config('request.jwt.claim.sub','$U',false);
  SELECT public.complete_session('$NEWID','completed','t-final',60,NULL);" | tail -1)
echo "$COMPLETE_JSON" | grep -q '"retention"' || { echo "FAIL: complete_session did NOT enforce (no retention key)"; FAILED=1; }

# Invariant: never more than two live transcripts for the user; expired rows carry no text.
AVAIL=$(P -qtAc "SELECT count(*) FROM public.sessions WHERE user_id='$U' AND transcript_state='available';")
BADEXP=$(P -qtAc "SELECT count(*) FROM public.sessions WHERE user_id='$U' AND transcript_state='expired' AND transcript IS NOT NULL;")
echo "result: available=$AVAIL expired_with_text=$BADEXP"
[ "$AVAIL" -le 2 ] || { echo "FAIL: more than two live transcripts ($AVAIL)"; FAILED=1; }
[ "$BADEXP" = "0" ] || { echo "FAIL: expired row retains transcript text"; FAILED=1; }

if [ "$FAILED" = "0" ]; then echo "PASS: both live writers (create_session_and_update_usage + complete_session) enforce retention; newest-two invariant holds"; else exit 1; fi
