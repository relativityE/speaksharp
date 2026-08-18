#!/usr/bin/env bash
# #1311 prefetch experiment — download the COMPLETE Canvas/Sharp + Playwright apt dependency bundle ONCE,
# from the standard Ubuntu archive (not the degraded Azure primary), with at most ONE retry of the
# safe download-only phase. Produces a checksum-verified .deb bundle for offline install on every shard.
# This runs ONLY in the upstream deps-prep job. It never installs/configures dpkg (download-only).
set -euo pipefail

BUNDLE="${1:?usage: apt-prefetch.sh <bundle-dir>}"
mkdir -p "$BUNDLE/debs"

# ── 1. Pin away from the degraded Azure primary to the standard Ubuntu archive (content-free log) ──────────
for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
  [ -f "$f" ] || continue
  sudo sed -i -E \
    -e 's#https?://azure\.archive\.ubuntu\.com/ubuntu#http://archive.ubuntu.com/ubuntu#g' \
    -e 's#mirror\+file:/etc/apt/apt-mirrors\.txt#http://archive.ubuntu.com/ubuntu#g' "$f" || true
done
echo "[prefetch] effective apt source(s):"
grep -rhoE 'https?://[a-z0-9.-]+/ubuntu' /etc/apt/sources.list /etc/apt/sources.list.d/ 2>/dev/null | sort -u | sed 's/^/[prefetch]   /'

# ── 2/3. Freeze the two manifests. Canvas/Sharp is the repo's explicit list; Playwright is DERIVED from
#         `playwright install-deps --dry-run` against the lockfile version (never a stale hard-coded list). ──
CANVAS_PKGS="build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev"
# Bring up the Playwright CLI WITHOUT building native canvas (--ignore-scripts skips the source build whose
# apt deps we are precisely here to fetch). Offline against the warm pnpm store restored by Setup Environment.
pnpm install --frozen-lockfile --prefer-offline --ignore-scripts
PW_DRY="$(pnpm exec playwright install-deps chromium --dry-run 2>&1 || true)"
# Flatten newlines/backslashes, isolate the apt-get install invocation, strip flags, keep package tokens.
PW_PKGS="$(printf '%s' "$PW_DRY" | tr '\n\\' '  ' \
  | grep -oiE 'apt-get install .*' | head -1 \
  | sed -E 's/apt-get install//; s/(^| )-y( |$)/ /g; s/--no-install-recommends//g' \
  | tr ' ' '\n' | grep -E '^[a-z][a-z0-9.+-]{2,}$' | sort -u | tr '\n' ' ')"
PW_COUNT="$(printf '%s' "$PW_PKGS" | wc -w | tr -d ' ')"
echo "[prefetch] playwright pkgs derived from --dry-run: count=$PW_COUNT"
if [ "$PW_COUNT" -lt 5 ]; then
  echo "::error::playwright install-deps --dry-run yielded only $PW_COUNT packages — refusing a stale/empty manifest"
  exit 1
fi
printf '%s\n' $CANVAS_PKGS | sort -u > "$BUNDLE/canvas-sharp.manifest"
printf '%s\n' $PW_PKGS     | sort -u > "$BUNDLE/playwright.manifest"
echo "[prefetch] canvas-sharp pkgs: $(wc -l < "$BUNDLE/canvas-sharp.manifest") | playwright pkgs: $(wc -l < "$BUNDLE/playwright.manifest")"

# ── 4. Bounded apt-get update against the pinned archive ───────────────────────────────────────────────────
sudo timeout -k 30 300 apt-get update

# ── 5. download-only, at most ONE retry, fresh process, clean only partials/locks between; never dpkg here ──
ALL_PKGS="$CANVAS_PKGS $PW_PKGS"
download_only() { sudo timeout -k 30 300 apt-get install --download-only -y --no-install-recommends $ALL_PKGS; }
if ! download_only; then
  echo "::warning::[prefetch] download-only attempt 1 failed/timed out; clearing partials+locks and retrying ONCE"
  sudo rm -f /var/cache/apt/archives/partial/*.deb /var/cache/apt/archives/lock /var/lib/apt/lists/lock 2>/dev/null || true
  # attempt 2 in a fresh process; if this also fails, `set -e` aborts → experiment fails cleanly (no 3rd try)
  download_only
fi

# ── 6. Collect completed .debs + SHA-256 manifest (no apt lists / partials / dpkg state / logs) ────────────
sudo cp /var/cache/apt/archives/*.deb "$BUNDLE/debs/" 2>/dev/null || true
sudo chown -R "$(id -u):$(id -g)" "$BUNDLE"
DEB_COUNT="$(find "$BUNDLE/debs" -name '*.deb' | wc -l | tr -d ' ')"
if [ "$DEB_COUNT" -lt 1 ]; then
  echo "::error::[prefetch] no .deb files fetched — failing closed"
  exit 1
fi
( cd "$BUNDLE/debs" && sha256sum *.deb | sort > ../sha256sums.txt )

# ── 7. Build a valid FLAT apt repository index over the .debs, so a shard's apt resolver can compute the
#       full closure LOCALLY (this is the fix for the earlier file-based `--no-download` "Unable to fetch").
#       Prefer dpkg-scanpackages (dpkg-dev); fall back to apt-ftparchive (apt-utils) if it is not present. ──
if command -v dpkg-scanpackages >/dev/null 2>&1; then
  ( cd "$BUNDLE/debs" && dpkg-scanpackages . /dev/null > Packages )
elif command -v apt-ftparchive >/dev/null 2>&1; then
  ( cd "$BUNDLE/debs" && apt-ftparchive packages . > Packages )
else
  echo "::error::[prefetch] no local-index tool (dpkg-scanpackages/apt-ftparchive) available"; exit 1
fi
PKG_ENTRIES="$(grep -c '^Package:' "$BUNDLE/debs/Packages" || echo 0)"
[ "$PKG_ENTRIES" -ge 1 ] || { echo "::error::[prefetch] empty local Packages index"; exit 1; }

# ── 8. Freeze the compatibility manifest — a shard MUST run on the same image or fail closed (no fallback). ─
. /etc/os-release 2>/dev/null || true
{
  echo "ImageOS=${ImageOS:-unknown}"
  echo "ImageVersion=${ImageVersion:-unknown}"
  echo "VERSION_CODENAME=${VERSION_CODENAME:-unknown}"
  echo "ARCH=$(dpkg --print-architecture)"
  echo "PLAYWRIGHT_VERSION=$(pnpm exec playwright --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
} > "$BUNDLE/image.manifest"

echo "[prefetch] bundle complete: ${DEB_COUNT} .deb files, $(wc -l < "$BUNDLE/sha256sums.txt") checksums, ${PKG_ENTRIES} Packages entries"
echo "[prefetch] image manifest:"; sed 's/^/[prefetch]   /' "$BUNDLE/image.manifest"
