#!/usr/bin/env bash
# Image-skew dispatcher — decide, BEFORE any installation is attempted, whether the prefetched bundle is
# usable on THIS shard, and route to exactly one installation path.
#
# WHY THIS EXISTS. `deps-prep` prefetches .debs on whichever runner image it happens to draw; each shard is
# scheduled independently and may draw a NEWER image. The `-dev` packages carry exact-equal dependencies
# (`libmount-dev : Depends: libmount1 (= 2.39.3-9ubuntu6.5)`), so a bundle built on image 20260823.283.1
# cannot resolve on a shard running 20260831.293.1 — its runtime libs are already 6.6. Observed on run
# 33661182891: prep=20260823.283.1, shards=20260831.293.1, `E: Unable to correct problems, you have held
# broken packages`, exit 100, in Setup Environment before a single test executed. A same-commit rerun moved
# the failing shard set (1,3 -> 3,4 -> 3), which is the signature of per-shard image assignment, not code.
#
# The previous design recorded ImageVersion as provenance and deliberately did NOT gate on it, on the
# reasoning that an exact-build proxy would block same-distribution shards during a rollout. That is true,
# and it is why a mismatch here does not simply fail: it takes a bounded compatibility path instead. What it
# must never do is attempt the stale bundle and discover the skew as a broken-package error mid-run.
#
# CONTRACT
#   * Provenance missing, empty, or `unknown` on EITHER side -> fail closed. An unknown image is not a match.
#   * Exact equality -> the existing checksum-verified, network-isolated offline install. Unchanged.
#   * Any inequality -> the bounded compatibility path, which resolves the SAME frozen package manifest
#     against the shard's own image. The stale bundle's .debs are never installed.
# Exactly one path runs. This script installs nothing itself.
set -euo pipefail

BUNDLE="${1:?usage: apt-install.sh <bundle-dir> <canvas-sharp|playwright>}"
MANIFEST="${2:?usage: apt-install.sh <bundle-dir> <canvas-sharp|playwright>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f "$BUNDLE/image.manifest" ] \
  || { echo "::error::[dispatch] missing provenance: $BUNDLE/image.manifest — fail closed"; exit 1; }

PREP_IMGVER="$(sed -n 's/^ImageVersion=//p' "$BUNDLE/image.manifest")"
SHARD_IMGVER="${ImageVersion:-}"

# `unknown` is what the prefetch writes when the runner did not export ImageVersion. Treating it as a value
# would let two unknowns compare equal and re-enter the offline path blind, which is the failure this gate
# exists to prevent.
for pair in "prep:$PREP_IMGVER" "shard:$SHARD_IMGVER"; do
  side="${pair%%:*}"; val="${pair#*:}"
  if [ -z "$val" ] || [ "$val" = "unknown" ]; then
    echo "::error::[dispatch] $side ImageVersion is missing/unknown ('${val}') — provenance cannot be established, fail closed"
    exit 1
  fi
done

if [ "$PREP_IMGVER" = "$SHARD_IMGVER" ]; then
  echo "[dispatch] image MATCH (prep=$PREP_IMGVER shard=$SHARD_IMGVER) — offline bundle install"
  exec bash "$SCRIPT_DIR/apt-install-offline.sh" "$BUNDLE" "$MANIFEST"
fi

echo "::warning::[dispatch] image SKEW (prep=$PREP_IMGVER shard=$SHARD_IMGVER) — the prefetched bundle is stale for this shard; taking the bounded compatibility path (bundle .debs NOT installed)"
exec bash "$SCRIPT_DIR/apt-install-compat.sh" "$BUNDLE" "$MANIFEST"
