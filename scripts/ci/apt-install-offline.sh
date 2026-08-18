#!/usr/bin/env bash
# #1311 prefetch experiment — install the prefetched, checksum-verified apt dependency bundle on a shard
# with network downloads DISABLED. Never contacts an apt mirror. No `timeout` wrapper (offline +
# deterministic), no retry, no dpkg repair. Any missing/invalid input fails CLOSED.
set -euo pipefail

BUNDLE="${1:?usage: apt-install-offline.sh <bundle-dir> <canvas-sharp|playwright>}"
# The manifest arg is the evidence label for what this shard requires; the single bundle contains the
# COMPLETE closure for both families, so every shard installs the same verified set from local files.
MANIFEST="${2:?usage: apt-install-offline.sh <bundle-dir> <canvas-sharp|playwright>}"

[ -d "$BUNDLE/debs" ]               || { echo "::error::[offline] bundle debs/ missing — fail closed";            exit 1; }
[ -f "$BUNDLE/sha256sums.txt" ]     || { echo "::error::[offline] checksum manifest missing — fail closed";       exit 1; }
[ -f "$BUNDLE/$MANIFEST.manifest" ] || { echo "::error::[offline] package manifest '$MANIFEST' missing — fail closed"; exit 1; }

# Verify EVERY .deb against SHA-256. Any mismatch/missing → fail closed, no install.
( cd "$BUNDLE/debs" && sha256sum -c ../sha256sums.txt ) \
  || { echo "::error::[offline] SHA-256 verification FAILED — refusing to install"; exit 1; }
echo "[offline] checksums verified: $(wc -l < "$BUNDLE/sha256sums.txt") .deb files ; manifest label=$MANIFEST"

# Install the COMPLETE prefetched closure directly from local .deb FILES with downloads DISABLED.
# File-based install needs NO apt lists (deps resolve from the file set + the dpkg status DB), and
# --no-download guarantees no mirror is ever contacted. If anything were unsatisfiable it errors here
# instead of fetching. No `timeout` wrapper and no retry/repair follow this transaction.
DEBS_ABS="$(cd "$BUNDLE/debs" && pwd)"
sudo apt-get install --no-download --no-install-recommends -y "$DEBS_ABS"/*.deb
echo "[offline] prefetched bundle installed from local files — zero apt mirror access"
