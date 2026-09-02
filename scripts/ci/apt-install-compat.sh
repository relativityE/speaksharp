#!/usr/bin/env bash
# Bounded compatibility path — reached ONLY from apt-install.sh when the prefetched bundle's ImageVersion
# does not equal this shard's. It resolves the SAME frozen package manifest against the shard's OWN image,
# from the standard Ubuntu archive.
#
# The stale bundle is used for exactly one thing: the list of package NAMES that were frozen at prep time
# ($BUNDLE/<manifest>.manifest). Its .debs are never referenced, never verified, never installed — an
# image-skewed .deb set is precisely what must not reach dpkg here.
#
# SAFETY CONTRACT (identical to the network apt fallback in setup-environment/action.yml, and deliberately
# not softened because this path is reached automatically): ONE bounded attempt under `timeout -k 30 300`.
# If the deadline expires the command may have been terminated MID-INSTALL, so the step fails the job
# immediately — NO retry, NO `dpkg --configure -a`, NO second apt transaction on this disposable runner.
# A timeout (rc 124/137) is reported DISTINCTLY from a genuine apt/dpkg exit. Linux-only (GNU timeout).
set -euo pipefail

BUNDLE="${1:?usage: apt-install-compat.sh <bundle-dir> <canvas-sharp|playwright>}"
MANIFEST="${2:?usage: apt-install-compat.sh <bundle-dir> <canvas-sharp|playwright>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# RETURN (#1406): the frozen manifest is only authoritative for a shard of the SAME Ubuntu family,
# codename, architecture and locked Playwright version. That authority lived inline in the offline script,
# so this path originally ran apt with none of it. It is enforced here BEFORE apt runs.
bash "$SCRIPT_DIR/apt-distribution-gate.sh" "$BUNDLE" compat

[ -f "$BUNDLE/$MANIFEST.manifest" ] \
  || { echo "::error::[compat] missing frozen manifest: $BUNDLE/$MANIFEST.manifest — fail closed"; exit 1; }

# The manifest arrives as a downloaded artifact, and its contents are about to become arguments to a
# privileged apt invocation. Validate every token against the Debian package-name grammar and refuse the
# whole transaction on anything else — a name carrying shell metacharacters must never reach a shell, and
# a silently-dropped bad token would install an incomplete set while reporting success.
PKGS=()
while read -r pkg; do
  [ -n "$pkg" ] || continue
  if ! printf '%s' "$pkg" | grep -qE '^[a-z0-9][a-z0-9.+-]+$'; then
    echo "::error::[compat] refusing manifest '$MANIFEST': token is not a valid package name"
    exit 1
  fi
  PKGS+=("$pkg")
done < "$BUNDLE/$MANIFEST.manifest"
PKG_COUNT="${#PKGS[@]}"
[ "$PKG_COUNT" -ge 1 ] \
  || { echo "::error::[compat] frozen manifest '$MANIFEST' is empty — refusing to install nothing"; exit 1; }

# Pin away from the degraded Azure primary to the standard Ubuntu archive, exactly as the prefetch does.
for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
  [ -f "$f" ] || continue
  sudo sed -i -E \
    -e 's#https?://azure\.archive\.ubuntu\.com/ubuntu#http://archive.ubuntu.com/ubuntu#g' \
    -e 's#mirror\+file:/etc/apt/apt-mirrors\.txt#http://archive.ubuntu.com/ubuntu#g' "$f" || true
done

echo "[compat] resolving '$MANIFEST' ($PKG_COUNT frozen packages) against this shard's own image from the standard Ubuntu archive"
echo "[phase] compat-apt START $(date -u +%H:%M:%S)"
set +e
# Package names are passed as ARGUMENTS ("$@"), never interpolated into the command string.
sudo timeout -k 30 300 sh -c 'apt-get update && apt-get install -y --no-install-recommends "$@"' sh "${PKGS[@]}"
rc=$?
set -e
echo "[phase] compat-apt END rc=$rc $(date -u +%H:%M:%S)"
if [ "$rc" = 124 ] || [ "$rc" = 137 ]; then
  echo "::error::[compat] apt hit the 300s deadline and was terminated (rc=$rc = TIMEOUT/CANCEL, not a genuine apt/dpkg exit). Failing job; runner discarded; no retry/repair."
elif [ "$rc" != 0 ]; then
  echo "::error::[compat] apt failed with a genuine apt/dpkg exit (rc=$rc)."
fi
exit $rc
