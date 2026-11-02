#!/bin/sh
# chrome-wrapper.sh: the only executable the harness gives Playwright or Lighthouse (CHROME_PATH).
# Starts the copied, pinned Chromium as uid/gid 65534 with no supplementary groups, no inheritable
# or bounding capabilities, and Chromium's own sandbox ON. It refuses sandbox-weakening flags rather
# than dropping them, so a caller that asks for them fails closed instead of running weaker.
# Installed by browser-setup.cjs at /var/tmp/ss-harness/chrome-wrapper.sh; the browser copy lives in
# /var/tmp/ss-harness/chrome-linux (world-readable, root-owned, traversable by 65534).
set -eu
# Explicit action-time approval and exact code identity are checked before profile ownership/browser startup.
[ -n "${SS_HARNESS_BUNDLE_ROOT:-}" ] && [ -n "${SS_HARNESS_APPROVAL_FILE:-}" ] && [ -n "${SS_HARNESS_NODE:-}" ] || { echo 'APPROVAL_REQUIRED: scoped R0 record and reviewed bundle paths absent' >&2; exit 78; }
"$SS_HARNESS_NODE" "$SS_HARNESS_BUNDLE_ROOT/harness/approval-check.cjs" "$SS_HARNESS_APPROVAL_FILE"
BROWSER=/var/tmp/ss-harness/chrome-linux/chrome
RUNAS=65534
# Exact per-run boundary flags (including duplicate/override refusal) are checked by pure reviewed code.
# Version discovery is an explicit mode accepting only --version; no navigation is possible there.
"$SS_HARNESS_NODE" "$SS_HARNESS_BUNDLE_ROOT/harness/browser-argument-check.cjs" "$@"
# Give the per-launch profile and download folders to 65534. Only folders created by Playwright or
# chrome-launcher directly under /tmp, or under the harness profile root, are accepted.
for a in "$@"; do
  case "$a" in
    --user-data-dir=*) d=${a#--user-data-dir=} ;;
    *) continue ;;
  esac
  case "$d" in
    /tmp/playwright_chromiumdev_profile-*|/tmp/lighthouse.*|/var/tmp/ss-harness/profiles/*) ;;
    *) echo "chrome-wrapper: refused profile path outside the harness roots" >&2; exit 65 ;;
  esac
  case "$d" in *..*|*/./*) echo "chrome-wrapper: refused non-canonical profile path" >&2; exit 65 ;; esac
  [ -d "$d" ] || { echo "chrome-wrapper: profile folder missing" >&2; exit 65; }
  [ ! -L "$d" ] || { echo "chrome-wrapper: profile folder is a symlink" >&2; exit 65; }
  chown -R "$RUNAS:$RUNAS" "$d"
done
export HOME=/var/tmp/ss-harness/home
exec env -i PATH=/usr/bin:/bin HOME=/var/tmp/ss-harness/home TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC setpriv --reuid="$RUNAS" --regid="$RUNAS" --clear-groups --inh-caps=-all --bounding-set=-all -- "$BROWSER" "$@"
