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

# ── 3. Isolated apt configuration whose ONLY source is the local flat repository. ALL paths are ABSOLUTE
#       and DEDICATED — sourcelist, an empty sourceparts dir, AND a dedicated empty lists dir — so apt cannot
#       resolve a relative path against /etc/apt, and candidate checks cannot pass off the runner's
#       pre-existing /var/lib/apt/lists indexes. The SAME OPTS are used for update, candidate check, install. ─
BUNDLE_ABS="$(cd "$BUNDLE" && pwd)"
DEBS_ABS="$BUNDLE_ABS/debs"
SRC="$BUNDLE_ABS/local-only.list"
SRCPARTS="$BUNDLE_ABS/empty-sourceparts"
LISTS="$BUNDLE_ABS/apt-lists"
mkdir -p "$SRCPARTS" "$LISTS/partial"
# [trusted=yes] is acceptable ONLY because the same-run artifact was SHA-256 verified above.
echo "deb [trusted=yes] file://$DEBS_ABS ./" > "$SRC"
OPTS=(-o "Dir::Etc::sourcelist=$SRC" -o "Dir::Etc::sourceparts=$SRCPARTS" -o "Dir::State::lists=$LISTS" -o "APT::Get::List-Cleanup=0")

# ── 4. Update from ONLY the local file: repository (populates the dedicated lists dir) ────────────────────
LOG="$BUNDLE_ABS/apt-local.log"
: > "$LOG"
sudo apt-get "${OPTS[@]}" update 2>&1 | tee -a "$LOG"

# ── 5. SOLE functional proof: resolve the COMPLETE frozen manifest through apt's OWN resolver against the
#       isolated local file: repository, no network. A successful simulation IS the repository-load,
#       dependency-resolution, virtual/transitional/preinstalled, and closure proof — we do NOT re-derive
#       any of that with shell parsing (no lists-layout / candidate / classification blockers). ───────────
PKGS="$(tr '\n' ' ' < "$BUNDLE/$MANIFEST.manifest")"
echo "[offline] simulating full '$MANIFEST' transaction under the isolated local repo ($(echo $PKGS | wc -w) packages)"
sudo apt-get "${OPTS[@]}" --no-install-recommends -y --simulate install $PKGS 2>&1 | tee -a "$LOG"

# ── 6. Real install through the SAME isolated configuration — reached ONLY if the simulation resolved ─────
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
