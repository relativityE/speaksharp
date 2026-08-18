#!/usr/bin/env bash
# #1311 local-repository install — install one manifest's apt packages on a shard from the prefetched,
# checksum-verified bundle, resolving the FULL closure through apt against a LOCAL flat `file:` repository
# only. Never contacts an apt mirror (no http/https). No `timeout` wrapper (deterministic, offline), no
# install retry, no dpkg repair. Any missing/invalid input, image mismatch, or checksum failure fails CLOSED.
set -euo pipefail

BUNDLE="${1:?usage: apt-install-offline.sh <bundle-dir> <canvas-sharp|playwright>}"
MANIFEST="${2:?usage: apt-install-offline.sh <bundle-dir> <canvas-sharp|playwright>}"

# ── 0. Presence checks (fail closed) ──────────────────────────────────────────────────────────────────────
for f in "$BUNDLE/debs" "$BUNDLE/sha256sums.txt" "$BUNDLE/$MANIFEST.manifest" "$BUNDLE/image.manifest" "$BUNDLE/debs/Packages"; do
  [ -e "$f" ] || { echo "::error::[offline] missing bundle input: $f — fail closed"; exit 1; }
done

# ── 1. Image compatibility — a shard MUST match the preparation image, else fail closed (NO mirror fallback) ─
PREP_OS="$(sed -n 's/^ImageOS=//p'      "$BUNDLE/image.manifest")"
PREP_VER="$(sed -n 's/^ImageVersion=//p' "$BUNDLE/image.manifest")"
PREP_ARCH="$(sed -n 's/^ARCH=//p'        "$BUNDLE/image.manifest")"
CUR_ARCH="$(dpkg --print-architecture)"
if [ "${ImageOS:-unknown}" != "$PREP_OS" ] || [ "${ImageVersion:-unknown}" != "$PREP_VER" ] || [ "$CUR_ARCH" != "$PREP_ARCH" ]; then
  echo "::error::[offline] image mismatch (prep=$PREP_OS/$PREP_VER/$PREP_ARCH shard=${ImageOS:-unknown}/${ImageVersion:-unknown}/$CUR_ARCH) — fail closed, NO mirror fallback"
  exit 1
fi
echo "[offline] image compatible: $PREP_OS / $PREP_VER / $PREP_ARCH"

# ── 2. Verify EVERY .deb against SHA-256 (fail closed) ────────────────────────────────────────────────────
( cd "$BUNDLE/debs" && sha256sum -c ../sha256sums.txt ) \
  || { echo "::error::[offline] SHA-256 verification FAILED — refusing to install"; exit 1; }
echo "[offline] checksums verified: $(wc -l < "$BUNDLE/sha256sums.txt") .deb files ; manifest=$MANIFEST"

# ── 3. Isolated apt configuration whose ONLY source is the local flat repository ──────────────────────────
DEBS_ABS="$(cd "$BUNDLE/debs" && pwd)"
SRC="$BUNDLE/local-only.list"
# [trusted=yes] is acceptable ONLY because the same-run artifact was SHA-256 verified above.
echo "deb [trusted=yes] file://$DEBS_ABS ./" > "$SRC"
# Override the global source list AND disable sources.list.d for these commands: no Azure/archive/HTTP source
# remains active while we update/install.
OPTS=(-o "Dir::Etc::sourcelist=$SRC" -o "Dir::Etc::sourceparts=/dev/null" -o "APT::Get::List-Cleanup=0")

# ── 4/5. Update + install through apt's resolver using ONLY the local file: repository ────────────────────
LOG="$BUNDLE/apt-local.log"
: > "$LOG"
sudo apt-get "${OPTS[@]}" update 2>&1 | tee -a "$LOG"
PKGS="$(tr '\n' ' ' < "$BUNDLE/$MANIFEST.manifest")"
echo "[offline] installing '$MANIFEST' via local repo: $(echo $PKGS | wc -w) frozen packages"
sudo apt-get "${OPTS[@]}" --no-install-recommends -y install $PKGS 2>&1 | tee -a "$LOG"

# ── 6. Network-isolation assertion — every transfer line must resolve to a file: URI. FORBIDDEN in any
#       effective source or apt output: http://, https://, azure.archive.ubuntu.com, archive.ubuntu.com,
#       or any non-file transport. (Get:/Ign:/Hit: lines for a file: repo are legitimate and allowed.) ────
if grep -nE 'https?://|azure\.archive\.ubuntu\.com|archive\.ubuntu\.com' "$SRC" "$LOG"; then
  echo "::error::[offline] NETWORK ISOLATION VIOLATED — a non-file source/transfer appeared above"; exit 1
fi
if grep -nE '^(Get|Hit|Ign):[0-9]* ' "$LOG" | grep -qvE '\bfile:'; then
  echo "::error::[offline] NETWORK ISOLATION VIOLATED — a non-file transfer line appeared above"; exit 1
fi
echo "[offline] '$MANIFEST' installed from the local file: repository — zero HTTP/HTTPS/mirror access"
