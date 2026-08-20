#!/usr/bin/env bash
# #1314 — EPHEMERAL PostgREST contract proof for complete_session_v2.
#
# A PostgreSQL service container proves LOCKING. It does not prove what PostgREST does with the same schema, and
# PostgREST is where this PR's earlier CI failure actually happened (PGRST202 on an unresolvable function). This
# runs a disposable PostgREST against a disposable Postgres and asserts the resolution, ACL, schema-cache and
# rollback behaviour that production application would otherwise be the first test of.
#
# Requires: docker, psql, curl, openssl. Exits non-zero on any failed assertion.
set -euo pipefail

JWT_SECRET="${PGRST_JWT_SECRET:-disposable-ci-only-secret-at-least-32-chars-long}"
PGRST_PORT="${PGRST_PORT:-3999}"
U='11111111-1111-4111-8111-111111111111'
M=backend/supabase/migrations
PSQL="psql -v ON_ERROR_STOP=1 -qAt"
REC='{"reasonCode":"HIGH_FILLER_RATE","actionCode":"REDUCE_FILLERS","metric":"filler_rate","value":0.08,"comparator":"above_baseline","templateVersion":"rec_v1"}'

fail() { echo "FAIL: $*" >&2; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # $1 = role
  local h p sig
  h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  p=$(printf '{"role":"%s","sub":"%s","exp":%s}' "$1" "$U" "$(( $(date +%s) + 3600 ))" | b64url)
  sig=$(printf '%s.%s' "$h" "$p" | openssl dgst -binary -sha256 -hmac "$JWT_SECRET" | b64url)
  printf '%s.%s.%s' "$h" "$p" "$sig"
}

# $1 = token, $2 = rpc name, $3 = json body -> prints "HTTPSTATUS<TAB>body"
call() {
  curl -s -o /tmp/pgrst.body -w '%{http_code}' \
    -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -X POST "http://127.0.0.1:${PGRST_PORT}/rpc/$2" -d "$3" || true
  printf '\t'; head -c 400 /tmp/pgrst.body
}

echo "== install the real migration chain =="
$PSQL -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE;" >/dev/null
for f in tests/db/transcript-retention-converge-bootstrap.sql \
         "$M/20260801000000_sessions_transcript_state.sql" \
         "$M/20260803000000_transcript_retention_newest_two.sql" \
         "$M/20260804000000_transcript_retention_converge_on_save.sql" \
         tests/db/atomic-completion-concurrency-realpg.sql \
         "$M/20260816223606_metrics_only_additive_1306.sql"; do
  $PSQL -f "$f" >/dev/null
done

echo "== PostgREST roles + a session to complete =="
# auth.uid() must understand THIS PostgREST's claim format. v12 sets `request.jwt.claims` (a JSON object);
# the shared bootstrap reads the pre-v9 `request.jwt.claim.sub`, so auth.uid() came back NULL and every RPC
# returned profile_not_found — the first real run caught it. Accept BOTH shapes here. This is a harness
# accommodation only: hosted Supabase populates the setting its own auth stack uses.
$PSQL >/dev/null <<SQL
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$fn\$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')
  )::uuid
\$fn\$;
SQL

$PSQL >/dev/null <<SQL
DO \$r\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END \$r\$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT anon, authenticated TO CURRENT_USER;
-- PostgREST sets request.jwt.claim.sub from the token; auth.uid() already reads it (bootstrap).
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
INSERT INTO auth.users(id) VALUES ('$U') ON CONFLICT DO NOTHING;
INSERT INTO public.user_profiles(id, subscription_status) VALUES ('$U','pro') ON CONFLICT DO NOTHING;
INSERT INTO public.sessions(id, user_id, status, duration)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001','$U','active',0) ON CONFLICT DO NOTHING;
SQL

BODY_V2=$(printf '{"p_session_id":"aaaaaaaa-aaaa-4aaa-8aaa-000000000001","p_status":"completed","p_final_duration":60,"p_reason":null,"p_next_action":%s,"p_total_words":100,"p_clarity_score":80,"p_wpm":120,"p_filler_counts":{},"p_pause_metrics":null,"p_final_transcript":"synthetic postgrest"}' "$REC")
AUTH=$(jwt authenticated); ANON=$(jwt anon)

echo
echo "== 1) SCHEMA CACHE: v2 does not exist yet -> must be unresolvable =="
R=$(call "$AUTH" complete_session_v2 "$BODY_V2"); echo "   $R"
[ "${R%%$'\t'*}" = "404" ] || fail "expected 404 before v2 exists, got ${R%%$'\t'*}"

echo "== 2) apply the migration, WITHOUT reloading the schema cache -> still unresolvable =="
$PSQL -f "$M/20260819120000_complete_session_v2_atomic_retention_1314.sql" >/dev/null
R=$(call "$AUTH" complete_session_v2 "$BODY_V2"); echo "   $R"
[ "${R%%$'\t'*}" = "404" ] || echo "   NOTE: PostgREST already saw it (auto-reload); the reload assertion below still applies"

echo "== 3) NOTIFY pgrst reload -> v2 resolves by NAMED ARGUMENTS =="
$PSQL -c "NOTIFY pgrst, 'reload schema';" >/dev/null; sleep 2
R=$(call "$AUTH" complete_session_v2 "$BODY_V2"); echo "   $R"
[ "${R%%$'\t'*}" = "200" ] || fail "v2 did not resolve through PostgREST after reload (got ${R%%$'\t'*})"
grep -q 'profile_not_found' /tmp/pgrst.body && fail "auth.uid() did not resolve from the JWT — the RPC ran but saw no identity"
grep -q 'transcript_outcome' /tmp/pgrst.body || fail "v2 response missing the typed transcript outcome"

echo "== 4) ACL: anon must NOT be able to execute v2 =="
R=$(call "$ANON" complete_session_v2 "$BODY_V2"); echo "   $R"
case "${R%%$'\t'*}" in 401|403|404) : ;; *) fail "anon executed v2 (got ${R%%$'\t'*}) — REVOKE FROM PUBLIC is not effective" ;; esac

echo "== 5) the PRE-EXISTING legacy ambiguity is REAL through PostgREST (300 Multiple Choices) =="
R=$(call "$AUTH" complete_session '{"p_session_id":"aaaaaaaa-aaaa-4aaa-8aaa-000000000001","p_status":"failed","p_reason":"x","p_final_duration":1}')
echo "   $R"
[ "${R%%$'\t'*}" = "300" ] || echo "   NOTE: expected 300 Multiple Choices, got ${R%%$'\t'*} — record the actual behaviour"

echo "== 6) ROLLBACK: drop v2 + reload -> unresolvable again (PGRST202) =="
$PSQL -c "DROP FUNCTION public.complete_session_v2(uuid,text,int,text,jsonb,int,double precision,double precision,jsonb,jsonb,text);
          NOTIFY pgrst, 'reload schema';" >/dev/null; sleep 2
R=$(call "$AUTH" complete_session_v2 "$BODY_V2"); echo "   $R"
[ "${R%%$'\t'*}" = "404" ] || fail "v2 still resolvable after rollback (got ${R%%$'\t'*})"

echo
echo "PASS: PostgREST resolves complete_session_v2 by named arguments, denies anon, and stops resolving it after rollback."
