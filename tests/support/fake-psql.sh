#!/usr/bin/env bash
# Test double for `psql`, used ONLY by tests/unit/postflightGate1306.test.js.
#
# The #1306 Stage B gate is pure SQL-shaped decision logic: it asks a fixed set of catalog questions and
# compares each answer to an expected literal. Stubbing the answers is what makes the DECISIONS falsifiable
# without a live database — a gate nobody can drive into a failing state is a gate nobody has tested.
#
# Each fixture value arrives as an environment variable; the query text selects which one to echo.
set -euo pipefail
query=""
while [ $# -gt 0 ]; do
  case "$1" in -c) query="$2"; shift 2;; *) shift;; esac
done
has() { case "$query" in *"$1"*) return 0;; *) return 1;; esac; }

V1A="uuid, text, text, integer, text"
V1B="uuid, text, integer, text, jsonb, integer, double precision, double precision, jsonb, jsonb"
V2="uuid, text, integer, text, jsonb, integer, double precision, double precision, jsonb, jsonb, text"

if has "split_part"; then echo "${F_V2_PUBLIC:-0}"; exit 0; fi

if has "has_function_privilege"; then
  role=$(printf '%s' "$query" | sed -n "s/.*has_function_privilege('\([a-z_]*\)'.*/\1/p")
  if has "proname='complete_session_v2'"; then
    case "$role" in
      authenticated) echo "${F_V2_AUTH:-t}";; service_role) echo "${F_V2_SVC:-t}";; anon) echo "${F_V2_ANON:-f}";;
    esac
  elif has "='$V1B'"; then
    case "$role" in authenticated) echo "${F_V1B_AUTH:-t}";; service_role) echo "${F_V1B_SVC:-t}";; esac
  else
    case "$role" in authenticated) echo "${F_V1A_AUTH:-t}";; service_role) echo "${F_V1A_SVC:-t}";; esac
  fi
  exit 0
fi

if has "proname='complete_session_v2'"; then
  if has "='$V2'"; then echo "${F_V2_COUNT:-1}"; else echo "${F_V2_OVERLOADS:-1}"; fi
  exit 0
fi

if has "='$V1A'"; then echo "${F_V1A_COUNT:-1}"; exit 0; fi
if has "='$V1B'"; then echo "${F_V1B_COUNT:-1}"; exit 0; fi
if has "proname='complete_session'"; then echo "${F_TOTAL_V1:-2}"; exit 0; fi

echo "fake-psql: unmatched query: $query" >&2
exit 3
