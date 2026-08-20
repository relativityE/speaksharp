#!/usr/bin/env bash
# #1314 — the fail-closed reload-confirmation DECISION, extracted so it can be mutation-tested.
# Exit 0 ONLY when a resolved complete_session_v2 returned its frozen non-mutating contract; exit 1 otherwise.
#
# Usage: postgrest-reload-confirmed.sh <http_code> <body_file>
#   confirmed IFF http_code == 200 AND body contains profile_not_found OR session_not_found.
#   Everything else — network/curl failure (caller passes code 000/empty), 401/403/404, 5xx, PGRST202,
#   malformed/empty body, any other PostgREST error — is NOT confirmed. Absence of PGRST202 is NOT sufficient.
set -uo pipefail
code="${1:-}"
body_file="${2:-}"
[ "$code" = '200' ] || exit 1
[ -n "$body_file" ] && [ -f "$body_file" ] || exit 1
grep -qE 'profile_not_found|session_not_found' "$body_file" || exit 1
# a PGRST error body must never count even if it somehow rode a 200
grep -q 'PGRST' "$body_file" && exit 1
exit 0
