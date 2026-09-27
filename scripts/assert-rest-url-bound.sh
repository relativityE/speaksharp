#!/usr/bin/env bash
# #1537 (Codex P1 r4115978885) — bind the REST verification path to the migration's project.
#
# The DB path is already bound to SUPABASE_PROJECT_ID (supabase link + the pooler resolved for that project). A REST
# probe sent to a SUPABASE_URL of ANOTHER project could return a passing answer that proves nothing about the migrated
# one. Exit 0 ONLY when SUPABASE_URL is exactly `https://<SUPABASE_PROJECT_ID>.supabase.co`, optionally followed by one
# trailing slash. Everything else — another ref, lookalike hosts, userinfo, http, ports, paths, whitespace, empty or
# missing values, a ref that is not a plain lowercase project ref — fails closed. Neither value is ever printed.
#
# Tested by tests/unit/assertRestUrlBound1537.test.js.
set -uo pipefail
fail() { echo '::error::REST URL is not bound to SUPABASE_PROJECT_ID — refusing the REST probe'; exit 1; }
url="${SUPABASE_URL:-}"
ref="${SUPABASE_PROJECT_ID:-}"
[[ "$ref" =~ ^[a-z0-9]{20}$ ]] || fail
[ -n "$url" ] || fail
url="${url%/}"
[ "$url" = "https://${ref}.supabase.co" ] || fail
exit 0
