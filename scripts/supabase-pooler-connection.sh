#!/usr/bin/env bash
# SEC-002 — fetch the Supabase pooler configuration and emit validated libpq settings.
#
# Thin network wrapper; ALL validation lives in supabase-pooler-validate.sh so it can be unit tested.
# Runtime discovery, never a hardcoded region or endpoint: the pooler hostname embeds a region that
# differs per project and can change, and a stale hardcoded host would fail exactly like the IPv6-only
# direct endpoint did — silently unreachable rather than obviously wrong.
#
# SANITIZATION: the API response can contain a full connection string with credentials. It is written
# to a 0600 temp file, never echoed, and removed on exit including on failure. curl runs silent with no
# -v, and this script must never be run under `set -x`.
#
# Requires: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID
# Usage:    supabase-pooler-connection.sh <out_env_file>
#
# TEST SEAM: CURL_BIN overrides the HTTP client so a test can prove that a malformed project ref makes
# NO request at all. Production workflows must never set it — the contract test fails if one does.
set -uo pipefail

CURL="${CURL_BIN:-curl}"

OUT_ENV="${1:-}"
[ -n "$OUT_ENV" ] || { echo 'pooler_out_env_missing'; exit 1; }
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || { echo 'pooler_access_token_missing'; exit 1; }
[ -n "${SUPABASE_PROJECT_ID:-}" ] || { echo 'pooler_project_id_missing'; exit 1; }

# PRE-NETWORK GRAMMAR CHECK. The ref is interpolated directly into the request URL below, so it must
# be validated BEFORE any request is made — not afterwards by the downstream validator. Checking only
# after the fetch means a malformed or hostile value has already been placed in a URL and sent. The
# same lowercase-alphanumeric grammar the validator enforces is applied here, first.
case "${SUPABASE_PROJECT_ID}" in
    *[!a-z0-9]*) echo 'pooler_project_id_malformed'; exit 1 ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

umask 077
payload="$(mktemp)"
cleanup() { rm -f "$payload"; }
trap cleanup EXIT

code="$("$CURL" -sS -o "$payload" -w '%{http_code}' \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H 'Accept: application/json' \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/config/database/pooler" 2>/dev/null)" \
    || { echo 'pooler_fetch_failed'; exit 1; }

# Status only — the body may carry credentials and must not reach the log.
[ "$code" = '200' ] || { echo "pooler_fetch_http_${code}"; exit 1; }

bash "$here/supabase-pooler-validate.sh" "$payload" "$OUT_ENV" "$SUPABASE_PROJECT_ID"
