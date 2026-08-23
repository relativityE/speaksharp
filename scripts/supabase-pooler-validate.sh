#!/usr/bin/env bash
# SEC-002 — validate a Supabase pooler configuration payload and emit libpq settings.
#
# PURE VALIDATION, no network. Kept separate from the fetch wrapper so every rejection path is unit
# testable; the fetch half is a trivial curl that cannot be meaningfully falsified.
#
# The direct database endpoint (db.<ref>.supabase.co) resolves IPv6-only and is unreachable from
# IPv4-only CI runners, which is how a verification gate came to exist that could never pass. This
# validator makes that endpoint — and the transaction-mode port, which does not support LISTEN/NOTIFY
# — structurally unrepresentable in the emitted settings.
#
# SANITIZATION: the payload may carry a full connection string. It is NEVER echoed, and no field is
# printed on success or failure. Failures emit a named reason code only.
#
# Usage: supabase-pooler-validate.sh <payload_json_file> <out_env_file> <project_ref>
set -uo pipefail

PAYLOAD="${1:-}"
OUT_ENV="${2:-}"
PROJECT_REF="${3:-}"

# Session mode. Transaction mode (6543) multiplexes connections and cannot carry LISTEN/NOTIFY, which
# the PostgREST reload proof requires. Hardcoded here rather than taken from the payload, whose default
# pool_mode is transaction.
readonly SESSION_PORT=5432
readonly FORBIDDEN_PORT=6543

fail() { echo "$1"; exit 1; }

[ -n "$PAYLOAD" ] && [ -f "$PAYLOAD" ] || fail 'pooler_payload_missing'
[ -s "$PAYLOAD" ] || fail 'pooler_payload_empty'
[ -n "$OUT_ENV" ] || fail 'pooler_out_env_missing'
[ -n "$PROJECT_REF" ] || fail 'pooler_project_ref_missing'

# The authorized project ref is the anchor for the whole identity contract below, so validate its
# grammar BEFORE it is used to build any expectation or reach the network. Supabase refs are lowercase
# alphanumeric; anything else means we cannot trust what we are about to compare against.
case "$PROJECT_REF" in
    *[!a-z0-9]*) fail 'pooler_project_ref_malformed' ;;
esac

jq -e . "$PAYLOAD" >/dev/null 2>&1 || fail 'pooler_payload_not_json'

# The endpoint returns either a single object or an array depending on version; normalise to an array
# WITHOUT assuming which, so a shape change surfaces as a named failure rather than a silent miss.
primary_count="$(jq '[ (if type == "array" then .[] else . end) | select(.database_type == "PRIMARY") ] | length' "$PAYLOAD" 2>/dev/null)"
[ -n "$primary_count" ] || fail 'pooler_payload_unreadable'
[ "$primary_count" -ne 0 ] || fail 'pooler_no_primary_result'
[ "$primary_count" -eq 1 ] || fail "pooler_multiple_primary_results:${primary_count}"

sel='[ (if type == "array" then .[] else . end) | select(.database_type == "PRIMARY") ][0]'
db_host="$(jq -r "${sel}.db_host // empty" "$PAYLOAD" 2>/dev/null)"
db_user="$(jq -r "${sel}.db_user // empty" "$PAYLOAD" 2>/dev/null)"

[ -n "$db_host" ] || fail 'pooler_host_missing'
[ -n "$db_user" ] || fail 'pooler_user_missing'

# Reject a host that smuggles a port, so the session port below cannot be overridden.
case "$db_host" in
    *:*) fail 'pooler_host_contains_port' ;;
esac

# SHELL SAFETY. These values come from a remote API and are written into a file the workflow SOURCES
# with `. file`. Sourcing evaluates each line, so an unvalidated value containing `$(...)`, backticks,
# a newline, or a quote would execute as code with the job's credentials. A strict positive charset —
# not a blocklist — is the only durable defence: anything outside it is rejected outright, so no
# quoting or escaping scheme has to be relied upon. Hostnames and pooler usernames legitimately need
# only alphanumerics, dot, hyphen, and (for users) underscore.
case "$db_host" in
    *[!A-Za-z0-9.-]*) fail 'pooler_host_unsafe_characters' ;;
esac
case "$db_user" in
    *[!A-Za-z0-9._-]*) fail 'pooler_user_unsafe_characters' ;;
esac

# PROJECT IDENTITY. Safe characters are not enough: a perfectly well-formed pooler username for a
# DIFFERENT project passes every check above and would be sourced into the production connection.
# The pooler username is project-scoped by construction, so require the exact expected value.
[ "$db_user" = "postgres.${PROJECT_REF}" ] || fail 'pooler_user_project_mismatch'

# ORDER MATTERS for diagnostics. The specific rejections must be tested BEFORE the general
# suffix check, or a direct endpoint and a port-smuggling host both report the vague
# 'not_pooler_endpoint' — correct refusals with a reason code that misdirects the operator.
# Never the IPv6-only direct endpoint, however it was spelled.
case "$db_host" in
    db.*.supabase.co|db.*.supabase.com) fail 'pooler_host_is_direct_endpoint' ;;
esac
[ "$db_host" != "db.${PROJECT_REF}.supabase.co" ] || fail 'pooler_host_is_direct_endpoint'

# ...and only then, must it be a pooler endpoint at all.
case "$db_host" in
    *.pooler.supabase.com) : ;;
    *) fail 'pooler_host_not_pooler_endpoint' ;;
esac

[ "$SESSION_PORT" != "$FORBIDDEN_PORT" ] || fail 'pooler_session_port_misconfigured'

umask 077
: > "$OUT_ENV" || fail 'pooler_out_env_unwritable'
{
    printf "PGHOST='%s'\n" "$db_host"
    printf "PGPORT='%s'\n" "$SESSION_PORT"
    printf "PGUSER='%s'\n" "$db_user"
    printf "PGDATABASE='postgres'\n"
    printf "PGSSLMODE='require'\n"
} >> "$OUT_ENV"

# Sanitized confirmation only — no host, user, or connection string.
echo "pooler_resolved mode=session port=${SESSION_PORT}"
exit 0
