#!/usr/bin/env bash
# #1117 R2 — TRUE two-connection real-PostgreSQL concurrency proof for the retention coordinator.
# PGlite is single-connection and cannot prove this; this stands up a throwaway local PostgreSQL cluster,
# applies the R2 migration chain verbatim, and drives concurrent same-user evaluation-completions across two
# connections, asserting the per-user profile lock serializes them to EXACTLY two live transcripts (no
# three-live state, no duplicate expiry, no error). No Docker; no hosted/production DB. Content-free.
set -euo pipefail

PGBIN=/opt/homebrew/opt/postgresql@17/bin
WT="$(cd "$(dirname "$0")/../.." && pwd)"           # worktree root
MIG="$WT/backend/supabase/migrations"
BOOT="$WT/tests/db/transcript-retention-concurrency-realpg-bootstrap.sql"
ROOT="$(mktemp -d /tmp/r2pg.XXXXXX)"
PORT=5434
export LC_ALL=C LANG=C
U='11111111-1111-4111-8111-111111111111'
sid() { printf 'aaaaaaaa-aaaa-4aaa-8aaa-%012d' "$1"; }

cleanup() { "$PGBIN/pg_ctl" -D "$ROOT/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$ROOT"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$ROOT/data" -U postgres --auth=trust >/dev/null 2>&1
"$PGBIN/pg_ctl" -D "$ROOT/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -k /tmp -c lc_messages=C" -w -l "$ROOT/log" start >/dev/null 2>&1
"$PGBIN/createdb" -h 127.0.0.1 -p $PORT -U postgres r2 >/dev/null 2>&1
PSQL() { psql -h 127.0.0.1 -p $PORT -U postgres -d r2 -v ON_ERROR_STOP=1 "$@"; }

# Apply the R2 migration chain verbatim on top of the minimal real bootstrap.
PSQL -q -f "$BOOT"
PSQL -q -f "$MIG/20260801000000_sessions_transcript_state.sql"
PSQL -q -f "$MIG/20260803000000_transcript_retention_newest_two.sql"
PSQL -q -f "$MIG/20260804000000_transcript_retention_converge_on_save.sql"

# Seed: one user + profile + 4 transcript-bearing sessions (S1 oldest .. S4 newest), NO evaluations yet.
PSQL -q -c "INSERT INTO auth.users(id) VALUES ('$U');"
PSQL -q -c "INSERT INTO public.user_profiles(id, subscription_status) VALUES ('$U','free');"
for k in 1 2 3 4; do
  PSQL -q -c "INSERT INTO public.sessions(id,user_id,created_at,transcript,total_words,duration)
              VALUES ('$(sid "$k")','$U', timestamptz '2026-07-0${k} 10:00:00Z', 't${k}', 100, 60);"
done

# Baseline: with no terminal evidence, retention is DEFERRED — all 4 transcripts still live (temporary rank>2).
BASE_AVAIL=$(PSQL -qtAc "SELECT count(*) FROM public.sessions WHERE user_id='$U' AND transcript_state='available';")
[ "$BASE_AVAIL" = "4" ] || { echo "FAIL: baseline expected 4 live (deferred), got $BASE_AVAIL"; exit 1; }

# CONCURRENCY: two connections complete terminal evaluations for the two outgoing candidates (S1, S2) at the
# same time. Each eval-insert fires the auto-convergence trigger -> converge -> profile-row FOR UPDATE lock.
# Conn A holds the lock across a sleep; Conn B's convergence must BLOCK on it, then run AFTER A commits and
# converge to exactly two live transcripts. This is a genuine lock-serialized interleaving.
psql -h 127.0.0.1 -p $PORT -U postgres -d r2 -v ON_ERROR_STOP=1 -c \
  "BEGIN; INSERT INTO public.session_progress_evaluations(user_id,session_id,formula_version,attribution_status,eligible)
          VALUES ('$U','$(sid 1)','clarity_v1','verified',true);
   SELECT pg_sleep(1); COMMIT;" >/dev/null 2>&1 &
CONN_A=$!
sleep 0.3
T0=$(date +%s.%N)
psql -h 127.0.0.1 -p $PORT -U postgres -d r2 -v ON_ERROR_STOP=1 -c \
  "BEGIN; INSERT INTO public.session_progress_evaluations(user_id,session_id,formula_version,attribution_status,eligible)
          VALUES ('$U','$(sid 2)','clarity_v1','verified',true);
   COMMIT;" >/dev/null 2>&1
T1=$(date +%s.%N)
wait $CONN_A
WAITED=$(awk "BEGIN{printf \"%.2f\", $T1-$T0}")

# Assertions: exactly TWO live transcripts (S3,S4), S1&S2 expired exactly once, no error, and Conn B was
# genuinely serialized behind Conn A's lock (waited ~0.7s+).
AVAIL=$(PSQL -qtAc "SELECT count(*) FROM public.sessions WHERE user_id='$U' AND transcript_state='available';")
EXP=$(PSQL -qtAc   "SELECT count(*) FROM public.sessions WHERE user_id='$U' AND transcript_state='expired';")
NULLTX=$(PSQL -qtAc "SELECT count(*) FROM public.sessions WHERE user_id='$U' AND transcript_state='expired' AND transcript IS NOT NULL;")
S3=$(PSQL -qtAc "SELECT transcript_state FROM public.sessions WHERE id='$(sid 3)';")
S4=$(PSQL -qtAc "SELECT transcript_state FROM public.sessions WHERE id='$(sid 4)';")

echo "result: available=$AVAIL expired=$EXP expired_with_text=$NULLTX  newest_two=[$S3,$S4]  connB_waited=${WAITED}s"
FAILED=0
[ "$AVAIL" = "2" ]   || { echo "FAIL: expected exactly 2 live transcripts, got $AVAIL"; FAILED=1; }
[ "$EXP" = "2" ]     || { echo "FAIL: expected exactly 2 expired, got $EXP"; FAILED=1; }
[ "$NULLTX" = "0" ]  || { echo "FAIL: an expired row still has transcript text"; FAILED=1; }
[ "$S3" = "available" ] && [ "$S4" = "available" ] || { echo "FAIL: newest two not both available ($S3,$S4)"; FAILED=1; }
awk "BEGIN{exit !($WAITED >= 0.5)}" || { echo "FAIL: Conn B was not serialized behind Conn A's profile lock (waited ${WAITED}s)"; FAILED=1; }

# Idempotency under convergence: a third converge is a no-op.
AGAIN=$(PSQL -qtAc "SELECT (public.converge_transcript_retention('$U')->>'expired_count');")
[ "$AGAIN" = "0" ] || { echo "FAIL: re-converge expired more rows ($AGAIN)"; FAILED=1; }

if [ "$FAILED" = "0" ]; then echo "PASS: two-connection concurrency converged to newest-two, serialized, idempotent, content-free"; else exit 1; fi
