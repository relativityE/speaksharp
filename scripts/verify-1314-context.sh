#!/usr/bin/env bash
# #1314 CONTEXT ATTESTATION — the freshness facts, as a paste rather than a recollection.
#
# WHY: nearly every recurring failure on #1314 was a claim running ahead of an exact artifact — stale checkout,
# stale packet hash, wrong tool version. This prints those facts and EXITS NONZERO on any mismatch, so a status
# report that omits its output is unfinished, and a report built on a stale context cannot be produced silently.
#
# Scope is deliberately #1314-only (per the 80/20 ruling): this is not a general framework.
#
# Usage:  scripts/verify-1314-context.sh
#   env EXPECTED_RELEASE=<sha>   also assert a loaded browser bundle matches (for human tests); optional.
set -uo pipefail

MIG=backend/supabase/migrations/20260819120000_complete_session_v2_atomic_retention_1314.sql
PACKET=product_release/work_items/1314-migration-apply-packet.md
REQUIRED_CLI=2.101.0
fails=0
line() { printf '%-28s %s\n' "$1" "$2"; }
bad()  { printf '%-28s %s  <-- MISMATCH\n' "$1" "$2"; fails=$((fails+1)); }

echo "== #1314 context attestation =="

# 1) worktree clean
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
[ "$DIRTY" = "0" ] && line "worktree" "clean" || bad "worktree" "$DIRTY uncommitted change(s)"

# 2) local vs remote PR head
git fetch -q origin agent/p0-private-stt-findings 2>/dev/null || true
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/agent/p0-private-stt-findings 2>/dev/null || echo "unknown")
line "local HEAD" "$LOCAL"
line "remote PR HEAD" "$REMOTE"
[ "$LOCAL" = "$REMOTE" ] && line "head match" "yes" || bad "head match" "local != remote (unpushed or behind)"

# 3) base
git fetch -q origin main 2>/dev/null || true
BASE=$(git merge-base HEAD origin/main 2>/dev/null || echo "unknown")
line "merge-base w/ main" "$BASE"

# 4) migration artifact identity, recomputed from the file
if [ -f "$MIG" ]; then
  BLOB=$(git hash-object "$MIG"); SHA=$(shasum -a 256 "$MIG" | awk '{print $1}')
  BYTES=$(wc -c < "$MIG" | tr -d ' '); LINES=$(wc -l < "$MIG" | tr -d ' ')
  line "migration blob" "$BLOB"
  line "migration sha256" "$SHA"
  line "migration size" "$BYTES bytes / $LINES lines"
  # 5) packet pins the same blob + sha
  if [ -f "$PACKET" ]; then
    PBLOB=$(grep -oE 'git blob \| `[0-9a-f]{40}`' "$PACKET" | grep -oE '[0-9a-f]{40}' | head -1)
    PSHA=$(grep -oE 'sha256 \| `[0-9a-f]{64}`' "$PACKET" | grep -oE '[0-9a-f]{64}' | head -1)
    [ "$PBLOB" = "$BLOB" ] && line "packet blob match" "yes" || bad "packet blob match" "packet=$PBLOB file=$BLOB"
    [ "$PSHA" = "$SHA" ]  && line "packet sha256 match" "yes" || bad "packet sha256 match" "packet=$PSHA file=$SHA"
  else bad "packet" "missing: $PACKET"; fi
else bad "migration" "missing: $MIG"; fi

# 6) packet references existing files
if [ -f "$PACKET" ]; then
  MISS=0
  for f in $(grep -oE '(scripts|product_release|backend)/[A-Za-z0-9_./-]+\.(sh|sql|md|mjs)' "$PACKET" | sort -u); do
    [ -e "$f" ] || { echo "  packet references missing file: $f"; MISS=$((MISS+1)); }
  done
  [ "$MISS" = "0" ] && line "packet file refs" "all exist" || bad "packet file refs" "$MISS missing"
fi

# 7) tool versions
if command -v supabase >/dev/null 2>&1; then
  CLI=$(supabase --version 2>/dev/null | head -1)
  line "supabase CLI (local)" "$CLI (pinned in CI: $REQUIRED_CLI)"
else line "supabase CLI (local)" "absent (CI uses pinned $REQUIRED_CLI)"; fi
line "node" "$(node --version 2>/dev/null || echo absent)"

# 8) no foreign-worktree test collection risk
FOREIGN=$(git ls-files test-support/worktrees 2>/dev/null | wc -l | tr -d ' ')
[ "$FOREIGN" = "0" ] && line "foreign-worktree tracked" "0" || bad "foreign-worktree tracked" "$FOREIGN files"

# 9) optional browser freshness (human test only)
if [ -n "${EXPECTED_RELEASE:-}" ]; then
  RUNNING="${LOADED_RELEASE:-<not provided>}"
  line "expected release" "$EXPECTED_RELEASE"
  line "loaded __APP_RELEASE__" "$RUNNING"
  [ "$RUNNING" = "$EXPECTED_RELEASE" ] && line "bundle fresh" "yes" || bad "bundle fresh" "stale or unverified bundle"
fi

echo
if [ "$fails" -ne 0 ]; then echo "ATTESTATION FAILED: $fails mismatch(es). Do not report a completion claim."; exit 1; fi
echo "ATTESTATION OK: context is consistent."
