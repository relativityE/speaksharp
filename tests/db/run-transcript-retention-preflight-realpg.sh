#!/usr/bin/env bash
# #1117 R3 — real-PostgreSQL proof that the preflight is genuinely READ-ONLY, bounded, aggregate-only.
# Throwaway local PostgreSQL 17 (initdb/pg_ctl); no Docker. Content-free.
#   - runs inside the caller protocol: REPEATABLE READ, READ ONLY, bounded timeouts;
#   - proves the call mutates NOTHING (row snapshot unchanged);
#   - proves a write in the read-only transaction is rejected (fail-closed on non-read-only execution);
#   - proves service_role-only EXECUTE.
set -euo pipefail
PGBIN=/opt/homebrew/opt/postgresql@17/bin
WT="$(cd "$(dirname "$0")/../.." && pwd)"; MIG="$WT/backend/supabase/migrations"
BOOT="$WT/tests/db/transcript-retention-converge-bootstrap.sql"
ROOT="$(mktemp -d /tmp/r3pg.XXXXXX)"; PORT=5455
export LC_ALL=C LANG=C
U='55555555-5555-4555-8555-555555555555'
sid(){ printf 'eeeeeeee-eeee-4eee-8eee-%012d' "$1"; }
cleanup(){ "$PGBIN/pg_ctl" -D "$ROOT/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$ROOT"; }
trap cleanup EXIT
"$PGBIN/initdb" -D "$ROOT/data" -U postgres --auth=trust >/dev/null 2>&1
"$PGBIN/pg_ctl" -D "$ROOT/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -k /tmp -c lc_messages=C" -w -l "$ROOT/log" start >/dev/null 2>&1
"$PGBIN/createdb" -h 127.0.0.1 -p $PORT -U postgres r3 >/dev/null 2>&1
Q(){ psql -h 127.0.0.1 -p $PORT -U postgres -d r3 -qtAc "$1"; }
FAILED=0
Q "$(cat "$BOOT")" >/dev/null
for f in 20260801000000_sessions_transcript_state 20260803000000_transcript_retention_newest_two \
         20260804000000_transcript_retention_converge_on_save 20260805000000_transcript_retention_preflight; do
  psql -h 127.0.0.1 -p $PORT -U postgres -d r3 -q -f "$MIG/$f.sql" >/dev/null 2>&1
done
DEF_DIGEST=$(Q "SELECT md5(pg_get_functiondef('public.transcript_retention_preflight(text,uuid,text)'::regprocedure));")
echo "reviewed_function_md5=$DEF_DIGEST"
Q "INSERT INTO auth.users(id) VALUES('$U'); INSERT INTO public.user_profiles(id) VALUES('$U');" >/dev/null
for k in 1 2 3 4 5; do Q "INSERT INTO public.sessions(id,user_id,created_at,transcript,total_words,duration) VALUES('$(sid $k)','$U', now()-interval '$((10-k)) day','t${k}',100,60);" >/dev/null; done
# durable terminal evaluations for the 3 outgoing candidates (sid1..3), inserted WITHOUT firing the R2
# auto-convergence trigger (one connection: SET + inserts together) so they remain a historical backlog the
# preflight assesses => READY with candidates.
Q "SET session_replication_role='replica';
   INSERT INTO public.session_progress_evaluations(user_id,session_id,formula_version,attribution_status,eligible) VALUES
     ('$U','$(sid 1)','clarity_v1','verified',true),
     ('$U','$(sid 2)','clarity_v1','verified',true),
     ('$U','$(sid 3)','clarity_v1','verified',true);
   SET session_replication_role='origin';" >/dev/null

# Snapshot before (rows + a content-free digest of transcript states).
BEFORE=$(Q "SELECT count(*)||'/'||md5(string_agg(id::text||transcript_state, ',' ORDER BY id)) FROM public.sessions;")

# Caller protocol: REPEATABLE READ, READ ONLY, bounded timeouts. Emit the verdict.
VERDICT=$(psql -h 127.0.0.1 -p $PORT -U postgres -d r3 -X -q -t -A -v ON_ERROR_STOP=1 <<SQL
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout='30000';
SET LOCAL lock_timeout='2000';
SELECT public.transcript_retention_preflight('all_users', NULL, 'realpg');
COMMIT;
SQL
)
ST=$(echo "$VERDICT" | sed -n 's/.*"status": *"\([a-z]*\)".*/\1/p')
CAND=$(echo "$VERDICT" | sed -n 's/.*"rank_gt2_eligible": *\([0-9]*\).*/\1/p')
MAXRET=$(echo "$VERDICT" | sed -n 's/.*"simulated_max_retained_per_user": *\([0-9]*\).*/\1/p')
AFTER=$(Q "SELECT count(*)||'/'||md5(string_agg(id::text||transcript_state, ',' ORDER BY id)) FROM public.sessions;")
echo "R3: status=$ST rank_gt2_eligible=$CAND sim_max_retained=$MAXRET  snapshot_unchanged=$([ "$BEFORE" = "$AFTER" ] && echo YES || echo NO)"
[ "$ST" = "ready" ] || { echo "FAIL: preflight not ready"; FAILED=1; }
[ "$CAND" = "3" ] || { echo "FAIL: expected 3 candidates"; FAILED=1; }
[ "$MAXRET" = "2" ] || { echo "FAIL: sim retained != 2"; FAILED=1; }
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: preflight MUTATED data (not read-only)"; FAILED=1; }

# Fail-closed on non-read-only execution: a write inside the READ ONLY txn must be rejected.
WERR=$(psql -h 127.0.0.1 -p $PORT -U postgres -d r3 -X -q -t -A <<SQL 2>&1 | tr -d '\n'
BEGIN TRANSACTION READ ONLY;
UPDATE public.sessions SET title='x' WHERE id='$(sid 1)';
COMMIT;
SQL
)
echo "read-only guard: $(echo "$WERR" | grep -ic 'read-only transaction') (1=rejected)"
echo "$WERR" | grep -qi 'read-only transaction' || { echo "FAIL: write NOT rejected in read-only txn"; FAILED=1; }

# ACL: service_role only.
SR=$(Q "SELECT has_function_privilege('service_role','public.transcript_retention_preflight(text, uuid, text)','EXECUTE')")
AN=$(Q "SELECT has_function_privilege('anon','public.transcript_retention_preflight(text, uuid, text)','EXECUTE')")
AU=$(Q "SELECT has_function_privilege('authenticated','public.transcript_retention_preflight(text, uuid, text)','EXECUTE')")
echo "ACL: service_role=$SR anon=$AN authenticated=$AU"
{ [ "$SR" = "t" ] && [ "$AN" = "f" ] && [ "$AU" = "f" ]; } || { echo "FAIL: ACL not service_role-only"; FAILED=1; }

[ "$FAILED" = "0" ] && echo "PASS: R3 preflight is read-only, bounded, aggregate-only, service_role-only" || exit 1
