#!/usr/bin/env bash
# #1306 Stage B — MACHINE-ENFORCED pre/postflight gate for retiring the legacy complete_session (v1).
#
# Asserts each expectation and EXITS NONZERO on any deviation, so a partial or wrong apply cannot be
# mistaken for a completed one. A readback that only prints state is a diagnostic, not a gate.
#
# WHY BOTH MODES MATTER HERE. `before` is not a formality: if the v1 overloads are already absent, the
# migration has nothing to retire and the run must stop rather than report a success it did not cause.
#
# CONNECTION: uses DB_URL if set, else the ambient PG* env — never a URI with an embedded credential.
#
# Usage:  DB_URL=postgres://… postflight-gate-1306.sh before|after
#   before  exact state expected BEFORE apply: both v1 overloads present and reachable, v2 intact
#   after   exact state expected after a CLEAN apply: zero v1 overloads, v2 and its grants untouched
set -euo pipefail

MODE="${1:-}"
[ "$MODE" = "before" ] || [ "$MODE" = "after" ] || { echo "usage: DB_URL=… $0 before|after" >&2; exit 2; }

if [ -n "${DB_URL:-}" ]; then PSQL=(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt)
else PSQL=(psql -v ON_ERROR_STOP=1 -qAt); fi
q() { "${PSQL[@]}" -c "$1"; }

fails=0
check() {
  if [ "$2" = "$3" ]; then printf '  OK   %-52s %s\n' "$1" "$3"
  else printf '  FAIL %-52s expected=%s actual=%s\n' "$1" "$2" "$3"; fails=$((fails+1)); fi
}

# Exact ARGUMENT TYPES of the two legacy overloads and the successor — types only, NO parameter names.
#
# TYPES ONLY, AND THE COMPARISON MUST AGREE. `pg_get_function_identity_arguments()` reconstructs the
# identity argument DECLARATION and includes parameter names whenever a function has them
# ("p_session_id uuid, ..."). These functions declare named parameters, so comparing that rendering
# against a types-only constant can never match, and every signature-derived check reports absence
# regardless of catalogue state.
#
# That mismatch fails as a REFUSAL, which is the hard direction to notice: a gate that wrongly refuses
# is indistinguishable from one that correctly refuses without reading the catalogue independently.
# Checks not built on the comparison (the PUBLIC-grant shape, the overload count) are unaffected, so a
# disagreement between them is the signal.
#
# `pg_catalog.oidvectortypes(p.proargtypes)` renders types only and never names, matching the form
# these constants are written in. This is the matching #1314's gate already uses.
V1A='uuid, text, text, integer, text'
V1B='uuid, text, integer, text, jsonb, integer, double precision, double precision, jsonb, jsonb'
V2='uuid, text, integer, text, jsonb, integer, double precision, double precision, jsonb, jsonb, text'

sig_count() { # $1 = proname, $2 = argument TYPES (no names)
  q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='$1'
       AND pg_catalog.oidvectortypes(p.proargtypes)='$2';"
}
# INDEPENDENT CONTROL. `to_regprocedure` resolves a signature through the parser rather than by string
# comparison, so it cannot share a formatting mistake with the catalogue query above. The two are
# cross-checked below: if they ever disagree, the gate stops rather than trusting whichever one happens
# to be consulted first.
regproc_present() { # $1 = proname, $2 = argument types -> 1/0
  q "SELECT (to_regprocedure('public.$1($2)') IS NOT NULL)::int;"
}
priv() { # $1 = role, $2 = proname, $3 = argument TYPES  -> t/f
  q "SELECT COALESCE(has_function_privilege('$1', p.oid, 'EXECUTE'), false)
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname='$2'
       AND pg_catalog.oidvectortypes(p.proargtypes)='$3';"
}
# Both resolvers must agree about existence for every signature the gate reasons about.
agree() { # $1 = label, $2 = proname, $3 = types
  local a b; a="$(sig_count "$2" "$3")"; b="$(regproc_present "$2" "$3")"
  if [ "$a" != "$b" ]; then
    printf '  FAIL %-52s catalogue=%s parser=%s\n' "$1 resolvers disagree" "$a" "$b"
    fails=$((fails+1))
  fi
}
# PUBLIC is not an ordinary role and cannot be passed to has_function_privilege; a PUBLIC grant appears in
# the ACL as an entry with an EMPTY grantee (`=X/grantor`), so it is detected by shape.
public_grants() { # $1 = proname
  q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
            unnest(COALESCE(p.proacl,'{}')) AS a
     WHERE n.nspname='public' AND p.proname='$1' AND split_part(a::text,'=',1)='';"
}

echo "#1306 Stage B gate — mode=$MODE"

agree 'v1-A' complete_session    "$V1A"
agree 'v1-B' complete_session    "$V1B"
agree 'v2'   complete_session_v2 "$V2"

TOTAL_V1="$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname='complete_session';")"

if [ "$MODE" = "before" ]; then
  # The premise. Retiring something already absent proves nothing.
  check 'v1-A (transcript overload) present'      1 "$(sig_count complete_session "$V1A")"
  check 'v1-B (metrics overload) present'         1 "$(sig_count complete_session "$V1B")"
  # BOTH overloads, BOTH roles. Checking grants only for v1-A left the premise incomplete: v1-B could be
  # present but unreachable by its callers, and the run would still proceed as though it were retiring a
  # live, reachable function.
  check 'v1-A executable by authenticated'        t "$(priv authenticated complete_session "$V1A")"
  check 'v1-A executable by service_role'         t "$(priv service_role   complete_session "$V1A")"
  check 'v1-B executable by authenticated'        t "$(priv authenticated complete_session "$V1B")"
  check 'v1-B executable by service_role'         t "$(priv service_role   complete_session "$V1B")"
else
  check 'v1-A absent'                             0 "$(sig_count complete_session "$V1A")"
  check 'v1-B absent'                             0 "$(sig_count complete_session "$V1B")"
  # Zero overloads of ANY arity: a partially-retired function is the worst of both states.
  check 'zero complete_session overloads remain'  0 "$TOTAL_V1"
fi

# The successor must be untouched in BOTH modes — this migration may not alter it.
check 'v2 exact signature present'                1 "$(sig_count complete_session_v2 "$V2")"
check 'v2 executable by authenticated'            t "$(priv authenticated complete_session_v2 "$V2")"
check 'v2 executable by service_role'             t "$(priv service_role   complete_session_v2 "$V2")"
check 'v2 NOT executable by anon'                 f "$(priv anon           complete_session_v2 "$V2")"
check 'v2 carries no PUBLIC grant'                0 "$(public_grants complete_session_v2)"
check 'exactly one complete_session_v2 overload'  1 "$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='complete_session_v2';")"

if [ "$fails" -ne 0 ]; then
  echo "::error::#1306 Stage B gate FAILED in mode=$MODE with $fails deviation(s)"
  exit 1
fi
echo "#1306 Stage B gate passed (mode=$MODE)"
