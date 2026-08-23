#!/usr/bin/env bash
# SEC-002 — prove the production database is REACHABLE and the session is REALLY encrypted.
#
# WHY THIS EXISTS. A verification step previously targeted an IPv6-only endpoint from an IPv4-only
# runner, so it could never connect. Because it ran AFTER an irreversible migration apply, the change
# landed while its confirmation was structurally impossible. This script is the pre-flight that makes
# that ordering safe: run it BEFORE any irreversible operation, and refuse to proceed if the
# verification path is unusable.
#
# WHAT IS PROVEN:
#   1. REACHABILITY — a real query round-tripped against the real database.
#   2. CLIENT-LEG TLS — the query above SUCCEEDED under exact `PGSSLMODE=require`. libpq refuses to
#      connect at all if the server will not negotiate TLS, so a completed query is itself the
#      evidence that the runner-to-pooler connection is encrypted. The mode is not a request whose
#      outcome is unknown; it is a precondition libpq enforces by failing closed.
#
# WHY pg_stat_ssl IS NOT USED. It reports the server's view of the BACKEND connection, and through a
# connection pooler that backend is pooler-to-Postgres — a different leg from ours, over the
# provider's internal network. It reads false on a perfectly healthy pooled session, so gating on it
# fails every run, and keeping it as an "informational" line would train readers to ignore a red
# signal. A check that is always wrong is worse than no check.
#
# NOT PROVEN HERE: certificate and hostname authenticity. `verify-full` would add that, at the cost of
# deliberate CA provisioning on the runner. Tracked as hardening, not claimed by this script.
#
# It also re-checks the endpoint at the point of use, so a caller cannot reach a forbidden endpoint by
# setting PG* directly and bypassing the pooler validator.
#
# SANITIZATION: emits reason codes only — never a host, user, port, or connection string.
#
# Requires: PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD/PGSSLMODE already exported.
#
# TEST SEAM: PSQL_BIN overrides the client binary so the reachability and TLS decisions can be
# falsified (including the ssl=false case) without a live database. Production workflows must never
# set it — tests/unit/postflightOnlyWorkflowContract.test.js fails if one does.
set -uo pipefail

PSQL="${PSQL_BIN:-psql}"

readonly SESSION_PORT=5432
readonly FORBIDDEN_PORT=6543

fail() { echo "$1"; exit 1; }

[ -n "${PGHOST:-}" ] || fail 'connectivity_pghost_unset'
[ -n "${PGUSER:-}" ] || fail 'connectivity_pguser_unset'
[ -n "${PGPASSWORD:-}" ] || fail 'connectivity_pgpassword_unset'
[ "${PGSSLMODE:-}" = 'require' ] || fail 'connectivity_pgsslmode_not_require'

# Defence in depth: the validator already forbids these, but PG* can be set by hand.
case "$PGHOST" in
    db.*.supabase.co|db.*.supabase.com) fail 'connectivity_direct_endpoint_forbidden' ;;
    *.pooler.supabase.com) : ;;
    *) fail 'connectivity_host_not_pooler_endpoint' ;;
esac
# Reject the transaction-mode port by name for a precise diagnostic, then require EXACTLY the session
# port. Rejecting only 6543 would let any other port through — a guard that forbids one wrong answer
# is not a guard that requires the right one.
[ "${PGPORT:-}" != "$FORBIDDEN_PORT" ] || fail 'connectivity_transaction_port_forbidden'
[ "${PGPORT:-}" = "$SESSION_PORT" ] || fail 'connectivity_port_not_session_mode'

# PROJECT IDENTITY AT POINT OF USE. The validator binds the user to the authorized project when it
# resolves the settings, but PG* can be set by hand and the settings file could be replaced between
# resolution and use. Re-assert the same contract where the connection is actually made, so a
# mismatch cannot slip through whichever way it arrives. Reason codes only — never echo the ref, the
# user, or the value received.
[ -n "${SUPABASE_PROJECT_ID:-}" ] || fail 'connectivity_project_id_unset'
case "${SUPABASE_PROJECT_ID}" in
    *[!a-z0-9]*) fail 'connectivity_project_id_malformed' ;;
esac
[ "$PGUSER" = "postgres.${SUPABASE_PROJECT_ID}" ] || fail 'connectivity_user_project_mismatch'
[ "${PGDATABASE:-}" = 'postgres' ] || fail 'connectivity_database_not_postgres'

# REACHABILITY + CLIENT-LEG TLS. This single round trip carries both claims: it can only succeed if
# libpq established an encrypted connection (PGSSLMODE=require, asserted exactly above) AND the
# database answered. The result must equal '1' — accepting any non-empty answer would let a stubbed
# or misdirected client fake success.
reachable="$("$PSQL" -v ON_ERROR_STOP=1 -qAt -c 'SELECT 1;' 2>/dev/null)" \
    || fail 'connectivity_unreachable'
[ "$reachable" = '1' ] || fail 'connectivity_unexpected_query_result'

echo 'connectivity_ok tls=require-enforced mode=session'
exit 0
