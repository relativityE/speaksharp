#!/usr/bin/env bash
# Outcome 4 D2 — replay, grant and rollback checks for the practised-tip migration on a THROWAWAY copy of the
# Supabase database image that the full-chain proof pins (supabase/postgres 17.6.1.155, same digest).
#
#   tests/db/manual/repeat-practised-tip-supabase-replay.sh
#
# What it does, with no other setup (needs a local Docker daemon):
#   1. Starts one container from the pinned image with NO network (`--network none`); every command runs inside it
#      with `docker exec`. It never connects to any other database.
#   2. Applies every versioned migration before D2 in filename order, each in one transaction, as the image's
#      non-superuser `postgres` role, and dumps the public schema (the baseline).
#   3. Applies D2. Checks that it only adds to the public schema (no existing line of the dump changes or goes) and
#      that the set of SECURITY DEFINER functions anon or authenticated can execute is unchanged.
#   4. Runs repeat-practised-tip-grants.sql (grants, search_path, owner, RLS) and repeat-practised-tip-supabase-smoke.sql
#      (the real save path: copy, bind before expiry, cleared by the next save; client read/write limits).
#   5. Runs repeat-practised-tip-rollback.sql and checks the public schema dumps byte-identical to the baseline, that
#      the app's fallback read works, and that the read with the new column fails with 42703, the error the app's
#      fallback handles. Then applies D2 again, to show it re-applies cleanly after a rollback.
#   6. Removes the container, whatever happened.
# Exit 0 and "REPLAY: OK" only when every check holds. Output is content-free (synthetic ids and one synthetic tip).
#
# Limits: this applies the files with psql in one container, not with the Supabase CLI and its auth/storage services,
# so it does not record supabase_migrations history or prove the CLI's own apply path. The full-chain CI proof does that
# once the migration is pinned there.
# Captured output from the author's run: tests/db/manual/repeat-practised-tip-supabase-replay.output.txt
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MIGRATIONS="$ROOT/backend/supabase/migrations"
HERE="$ROOT/tests/db/manual"
D2=20261112010000_repeat_practised_tip.sql
IMAGE_TAG=17.6.1.155
IMAGE_DIGEST=sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b   # = imagePins in account-closure-full-chain-diagnostics.mjs

[[ -z "${DOCKER_HOST:-}" || "${DOCKER_HOST}" == unix://* ]] || { echo "refusing a remote Docker context" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "a local Docker daemon is required" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/tip-replay-XXXXXX")"
NAME="tip-replay-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

docker pull -q "supabase/postgres@$IMAGE_DIGEST" >/dev/null
docker run -d --name "$NAME" --network none --label speaksharp.d2-replay="$NAME" \
  -e POSTGRES_PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" "supabase/postgres@$IMAGE_DIGEST" >/dev/null
# -h localhost only answers once the image's init scripts have finished and the server has restarted for real.
for _ in $(seq 1 90); do docker exec "$NAME" pg_isready -q -U postgres -h localhost 2>/dev/null && break; sleep 2; done
docker exec "$NAME" pg_isready -q -U postgres -h localhost || { echo "database did not start" >&2; exit 2; }
sleep 2
docker exec "$NAME" mkdir -p /tmp/d2 /tmp/d2/m
docker cp "$MIGRATIONS/." "$NAME:/tmp/d2/m/" >/dev/null
for f in repeat-practised-tip-grants.sql repeat-practised-tip-supabase-smoke.sql repeat-practised-tip-rollback.sql; do
  docker cp "$HERE/$f" "$NAME:/tmp/d2/$f" >/dev/null
done

psqlc() { docker exec -i "$NAME" psql -X -q -U postgres -h localhost -d postgres -v ON_ERROR_STOP=1 "$@"; }
# Notices and the "transaction in progress" warnings from older files that carry their own BEGIN/COMMIT are not shown.
apply() { docker exec -i -e PGOPTIONS='-c client_min_messages=error' "$NAME" psql -X -q -U postgres -h localhost -d postgres \
  -v ON_ERROR_STOP=1 -1 -f "/tmp/d2/m/$1" >/dev/null; }
dump() { docker exec "$NAME" pg_dump -U postgres -h localhost --schema-only --schema=public -d postgres | grep -v '^-- Dumped \|^\\restrict\|^\\unrestrict'; }
exposed() { psqlc -Atc "SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))
  ORDER BY 1"; }

ok=1
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; ok=0; }

image_id="$(docker inspect -f '{{.Image}}' "$NAME")"
echo "Image:      supabase/postgres:$IMAGE_TAG  $image_id  (pinned $IMAGE_DIGEST)"
echo "PostgreSQL: $(psqlc -Atc 'SHOW server_version')  role postgres superuser=$(psqlc -Atc "SELECT rolsuper FROM pg_roles WHERE rolname='postgres'")"
echo "Migration:  $D2  sha256 $(sha256sum "$MIGRATIONS/$D2" | cut -d' ' -f1)"
echo

echo "== 1. Replay every migration before D2"
mapfile -t ALL < <(ls "$MIGRATIONS" | grep -E '^[0-9]{8,14}_.+\.sql$' | sort)
[[ "${ALL[-1]}" == "$D2" ]] || { echo "D2 is not the newest migration; this check assumes it is" >&2; exit 2; }
n=0
for f in "${ALL[@]}"; do [[ "$f" == "$D2" ]] && break; apply "$f"; n=$((n+1)); done
pass "$n migrations applied in filename order with psql --single-transaction and ON_ERROR_STOP"
dump > "$WORK/baseline.sql"
exposed > "$WORK/exposed-before.txt"

echo; echo "== 2. Apply D2"
if grep -qiE '^\s*(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\s*;|CONCURRENTLY|^\s*VACUUM' "$MIGRATIONS/$D2"; then fail "D2 has its own transaction control or a non-transactional statement"
else pass "D2 has no transaction control and no non-transactional statement"; fi
{ cat "$MIGRATIONS/$D2"; printf '\nSELECT 1/0; -- injected failure at the very end\n'; } > "$WORK/d2-fails-at-end.sql"
docker cp "$WORK/d2-fails-at-end.sql" "$NAME:/tmp/d2/m/zz-d2-fails-at-end.sql" >/dev/null
if apply zz-d2-fails-at-end.sql 2>/dev/null; then fail "the injected failure did not fail"
else dump > "$WORK/after-failed.sql"; diff -q "$WORK/baseline.sql" "$WORK/after-failed.sql" >/dev/null \
  && pass "a copy of D2 that fails on its last statement leaves the schema byte-identical to the baseline (all or nothing)" \
  || fail "a failed apply left part of D2 behind"; fi
apply "$D2" && pass "$D2 applied in one transaction" || { fail "$D2 did not apply"; echo "REPLAY: NOT OK"; exit 1; }
dump > "$WORK/d2.sql"
# Compare as sets of lines: pg_dump may move the table above a function that now uses its row type, and a column
# added to a table changes the comma on the line before it. Every baseline line must still be present.
norm() { sed 's/,$//' "$1" | sort; }
removed="$(comm -23 <(norm "$WORK/baseline.sql") <(norm "$WORK/d2.sql") | grep -cv '^$' || true)"
added="$(comm -13 <(norm "$WORK/baseline.sql") <(norm "$WORK/d2.sql") | grep -cv '^$' || true)"
if [[ "$removed" == 0 ]]; then pass "D2 only adds to the public schema ($added dump lines added; every existing line, grant and policy kept)"
else fail "D2 changes or removes $removed existing dump lines:"; comm -23 <(norm "$WORK/baseline.sql") <(norm "$WORK/d2.sql") | grep -v '^$' | head -40 || true; fi
exposed > "$WORK/exposed-after.txt"
diff -q "$WORK/exposed-before.txt" "$WORK/exposed-after.txt" >/dev/null \
  && pass "no new SECURITY DEFINER function is executable by anon or authenticated ($(wc -l < "$WORK/exposed-after.txt") such functions before and after)" \
  || fail "the set of client-executable SECURITY DEFINER functions changed"

echo; echo "== 3. Grants"
psqlc -f /tmp/d2/repeat-practised-tip-grants.sql || fail "grant checks"

echo; echo "== 4. Behaviour on the real save path"
psqlc -f /tmp/d2/repeat-practised-tip-supabase-smoke.sql 2>&1 | sed 's/^psql:[^ ]* ERROR:  /refused as expected: /' || fail "smoke"

echo; echo "== 5. Rollback"
psqlc -f /tmp/d2/repeat-practised-tip-rollback.sql >/dev/null && pass "rollback ran in one transaction" || fail "rollback did not run"
dump > "$WORK/rolled-back.sql"
if diff -q "$WORK/baseline.sql" "$WORK/rolled-back.sql" >/dev/null; then pass "after rollback the public schema dump is byte-identical to the baseline"
else fail "after rollback the public schema differs from the baseline:"; diff "$WORK/baseline.sql" "$WORK/rolled-back.sql" | head -40; fi
fallback="$(psqlc -Atc "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-0000000000d2',false);
  SELECT count(*) FROM public.progress_recommendation_attempts WHERE user_id='aaaaaaaa-0000-4000-8000-0000000000d2'
  AND lifecycle IS NOT NULL AND id IS NOT NULL AND recommendation_id IS NOT NULL
  AND (outcome IS NULL OR outcome IS NOT NULL) AND (practice_session_id IS NULL OR practice_session_id IS NOT NULL)
  AND (next_comparable_session_id IS NULL OR next_comparable_session_id IS NOT NULL);" | tail -1)"
[[ "$fallback" == 1 ]] && pass "the app's fallback read (its seven attempt columns, as the owner) still returns the owner's attempt" || fail "fallback read returned '$fallback'"
newread="$(docker exec -i "$NAME" psql -X -q -U postgres -h localhost -d postgres -v VERBOSITY=verbose \
  -c "SET ROLE authenticated; SELECT practised_tip FROM public.progress_recommendation_attempts LIMIT 1" 2>&1 || true)"
grep -q '42703' <<<"$newread" && grep -q 'practised_tip' <<<"$newread" \
  && pass "the read with practised_tip fails with 42703 naming the column, which the app's fallback handles" || fail "unexpected error for the new-column read: $newread"
apply "$D2" && pass "D2 applies again cleanly after the rollback" || fail "D2 did not re-apply after the rollback"
dump > "$WORK/reapplied.sql"
diff -q "$WORK/d2.sql" "$WORK/reapplied.sql" >/dev/null && pass "and the schema matches the first application exactly" || fail "re-applied schema differs from the first application"

echo
[[ $ok -eq 1 ]] && echo "REPLAY: OK" || echo "REPLAY: NOT OK"
[[ $ok -eq 1 ]]
