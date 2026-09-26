#!/usr/bin/env bash
# #1537 (Codex P1 r4112619095) — the fail-closed decision behind the product-marker postflight, extracted so it can be
# mutation-tested (tests/unit/postgrestColumnReadable1258.test.js).
#
# Usage: postgrest-column-readable.sh <http_code> <body_file>
#   Confirmed IFF http_code == 200 AND the body is exactly the empty JSON array `[]` (whitespace ignored): PostgREST
#   resolved every selected column and returned no row. The probe is a NO-ROW read (a nonexistent id, limit=0), so a
#   returned row is a failure too — it must never carry user data. Everything else — transport failure (000/empty),
#   401/403/404, 5xx, a stale-cache or missing-column error (42703, PGRST204, PGRST100), an error riding a 200, an
#   empty, malformed or non-array body — is NOT confirmed.
set -uo pipefail
code="${1:-}"
body_file="${2:-}"
[ "$code" = '200' ] || exit 1
[ -n "$body_file" ] && [ -f "$body_file" ] || exit 1
body="$(tr -d '[:space:]' < "$body_file")"
[ "$body" = '[]' ] || exit 1
exit 0
