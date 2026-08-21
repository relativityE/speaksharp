#!/usr/bin/env bash
# #1306 / #1314 — postflight-only migration-STATE assertion, extracted from the workflow so it is
# falsifiable in unit tests rather than being unreviewable inline bash.
#
# Answers exactly one question against a `supabase migration list` capture:
#   "is the reviewed target APPLIED, and is every held migration STILL PENDING?"
#
# It deliberately does NOT apply, repair, push, or mutate anything — it only reads a captured list.
# Exit 0 only when both conditions hold; exit 1 with a named reason otherwise. Fail-closed: an empty,
# truncated, or unparseable capture FAILS rather than passing for lack of contrary evidence.
#
# Usage: postflight-migration-state.sh <migration_list_file> <applied_version> <held_version>...
set -uo pipefail

LIST_FILE="${1:-}"
APPLIED_VERSION="${2:-}"
shift 2 || true
HELD_VERSIONS=("$@")

[ -n "$LIST_FILE" ] && [ -f "$LIST_FILE" ] || { echo "postflight_state_missing_list_file"; exit 1; }
[ -n "$APPLIED_VERSION" ] || { echo "postflight_state_missing_applied_version"; exit 1; }
[ -s "$LIST_FILE" ] || { echo "postflight_state_empty_capture"; exit 1; }

# `supabase migration list` renders "  <local> | <remote> | <time>". A migration is APPLIED when the
# remote column carries its version; PENDING when the remote column is blank. Anchor on the local
# column so a version appearing only inside a timestamp or path can never satisfy the match.
row_for() { grep -E "^[[:space:]]*${1}[[:space:]]*\|" "$LIST_FILE" | head -1; }

remote_col() {
    # field 2 of the pipe-delimited row, whitespace-stripped
    printf '%s' "$1" | awk -F'|' '{ gsub(/[[:space:]]/, "", $2); print $2 }'
}

target_row="$(row_for "$APPLIED_VERSION")"
[ -n "$target_row" ] || { echo "postflight_state_target_absent_from_list:${APPLIED_VERSION}"; exit 1; }
if [ "$(remote_col "$target_row")" != "$APPLIED_VERSION" ]; then
    echo "postflight_state_target_not_applied:${APPLIED_VERSION}"
    exit 1
fi

rc=0
for held in "${HELD_VERSIONS[@]}"; do
    [ -n "$held" ] || continue
    held_row="$(row_for "$held")"
    if [ -z "$held_row" ]; then
        # A held migration vanishing from the list is itself a contract breach, not a pass.
        echo "postflight_state_held_absent_from_list:${held}"
        rc=1
        continue
    fi
    if [ -n "$(remote_col "$held_row")" ]; then
        echo "postflight_state_held_was_applied:${held}"
        rc=1
    fi
done
[ "$rc" -eq 0 ] || exit 1

echo "postflight_state_ok applied=${APPLIED_VERSION} held_pending=${HELD_VERSIONS[*]:-none}"
exit 0
