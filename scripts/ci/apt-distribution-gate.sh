#!/usr/bin/env bash
# Distribution compatibility authority — prep and the consuming shard MUST agree on Ubuntu FAMILY +
# CODENAME + ARCH + the locked Playwright version, or the frozen manifest is not authoritative for this
# shard and nothing may be installed from it. Fails closed, no mirror fallback.
#
# WHY THIS IS SHARED. It began inline in apt-install-offline.sh, so the bounded compatibility path added in
# #1313 silently ran apt with NO distribution authority at all: an image-skewed shard on a different
# codename or architecture would have installed the frozen package set anyway. Both installation paths now
# call this one implementation, so the authority cannot hold on one path and be absent on the other.
#
# ImageVersion is deliberately NOT checked here — that is apt-install.sh's exact-equality gate, which
# decides WHICH path runs. This gate decides whether EITHER may run at all.
set -euo pipefail

BUNDLE="${1:?usage: apt-distribution-gate.sh <bundle-dir> [label]}"
LABEL="${2:-gate}"

# -f then -r, reported separately: an unreadable manifest would otherwise pass -f and die inside the first
# `sed` under `set -e`, failing closed but with no named error to act on.
[ -f "$BUNDLE/image.manifest" ] \
  || { echo "::error::[$LABEL] missing $BUNDLE/image.manifest — no distribution authority, fail closed"; exit 1; }
[ -r "$BUNDLE/image.manifest" ] \
  || { echo "::error::[$LABEL] unreadable $BUNDLE/image.manifest — no distribution authority, fail closed"; exit 1; }

PREP_FAMILY="$(sed -n 's/^FAMILY=//p'         "$BUNDLE/image.manifest")"
PREP_CODENAME="$(sed -n 's/^CODENAME=//p'     "$BUNDLE/image.manifest")"
PREP_ARCH="$(sed -n 's/^ARCH=//p'             "$BUNDLE/image.manifest")"
PREP_PW="$(sed -n 's/^PLAYWRIGHT_VERSION=//p' "$BUNDLE/image.manifest")"

# `.` is a POSIX special builtin: sourcing a missing file exits the shell outright, and `|| true` does not
# prevent it. Guard on readability instead — the field checks below already fail closed on an absent ID.
if [ -r /etc/os-release ]; then . /etc/os-release; fi
CUR_FAMILY="${ID:-unknown}"; CUR_CODENAME="${VERSION_CODENAME:-unknown}"; CUR_ARCH="$(dpkg --print-architecture)"
CUR_PW="$(grep -m1 -oE 'playwright-core@[0-9]+\.[0-9]+\.[0-9]+' pnpm-lock.yaml 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"

# An absent or `unknown` field on either side is not a match. Two unknowns comparing equal would grant
# authority precisely where none was established.
for pair in "family:$PREP_FAMILY:$CUR_FAMILY" "codename:$PREP_CODENAME:$CUR_CODENAME" "arch:$PREP_ARCH:$CUR_ARCH" "playwright:$PREP_PW:$CUR_PW"; do
  field="${pair%%:*}"; rest="${pair#*:}"; prep="${rest%%:*}"; cur="${rest#*:}"
  if [ -z "$prep" ] || [ -z "$cur" ] || [ "$prep" = "unknown" ] || [ "$cur" = "unknown" ]; then
    echo "::error::[$LABEL] $field authority missing/unknown (prep='$prep' shard='$cur') — fail closed"
    exit 1
  fi
  if [ "$prep" != "$cur" ]; then
    echo "::error::[$LABEL] distribution mismatch on $field (prep=$PREP_FAMILY/$PREP_CODENAME/$PREP_ARCH/pw$PREP_PW shard=$CUR_FAMILY/$CUR_CODENAME/$CUR_ARCH/pw$CUR_PW) — fail closed, NO mirror fallback"
    exit 1
  fi
done
echo "[$LABEL] distribution compatible: $PREP_FAMILY/$PREP_CODENAME/$PREP_ARCH/playwright-$PREP_PW"
