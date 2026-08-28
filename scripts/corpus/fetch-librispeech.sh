#!/usr/bin/env bash
# #1304 Task 4 — acquire the LibriSpeech test sets. READ-ONLY download; nothing here touches the product.
#
# The archives are ~660 MB combined and are DELIBERATELY kept out of git (see .gitignore). What is
# committed is their SHA-256 and the frozen subset manifest — the checksum is the corpus's identity,
# not its size.
#
# SIZES, from the server rather than from anyone's memory (verified 2026-08-27):
#   test-clean.tar.gz  346,663,984 bytes  (330.6 MiB / 346.7 MB)
#   test-other.tar.gz  328,757,843 bytes  (313.5 MiB / 328.8 MB)
# Two conflicting figures were previously on record — 331/314 and 346/328. BOTH were right: one set
# was MiB and the other MB, with neither stating its unit. Bytes are recorded here so it cannot recur.
#
# Licence: CC BY 4.0. The attribution line travels in the manifest, not just in this comment.
set -euo pipefail

# RESOLVE EVERYTHING TO ABSOLUTE PATHS BEFORE ANY `cd`.
# The previous version resolved the verifier with `dirname "$0"` AFTER `cd "$DEST"`, so the documented
# command simply failed: a relative script path stops meaning anything once the working directory
# moves. That is the same persistent-cwd defect class that has produced false conclusions in this
# project more than once — here it broke the command outright rather than lying about a result.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER="${SCRIPT_DIR}/verify-archive.mjs"
[ -f "$VERIFIER" ] || { echo "FATAL: verifier not found at ${VERIFIER}" >&2; exit 1; }

DEST="${1:-bench-corpus}"
BASE="https://www.openslr.org/resources/12"

# The archives to fetch. Byte counts and official MD5s live in ONE place — verify-archive.mjs — so the
# shell cannot drift from the verifier. Duplicating the expectation here is how two authorities for one
# fact begin.
declare -a SETS=("test-clean" "test-other")

# bootstrap = no SHA-256 pin exists yet (bytes + publisher MD5 still REQUIRED).
# pinned    = every layer required, including our SHA-256. This is the normal mode.
VERIFY_MODE="${VERIFY_MODE:-pinned}"

mkdir -p "$DEST"
cd "$DEST"

for entry in "${SETS[@]}"; do
    name="$entry"
    archive="${name}.tar.gz"

    if [ ! -f "$archive" ]; then
        echo "==> fetching ${archive}"
        curl -fL --retry 3 --continue-at - -o "$archive" "${BASE}/${archive}"
    else
        echo "==> ${archive} already present, skipping download"
    fi

    # No byte check here: the verifier owns every expectation, in one place.
done

echo "==> VERIFYING before extraction: byte count -> official MD5 -> SHA-256"
# Layered, and the ORDER is the point. A byte count cannot see corruption at the correct length, and a
# SHA-256 computed BEFORE the publisher's MD5 passes would pin whatever arrived — which is what the
# first version of this script did and then called a pin.
for entry in "${SETS[@]}"; do
    name="$entry"
    node "$VERIFIER" --mode="${VERIFY_MODE}" "${PWD}/${name}.tar.gz" "${name}.tar.gz" || {
        echo "FATAL: ${name}.tar.gz failed integrity verification — NOT extracting." >&2
        exit 1
    }
done

echo "==> extracting"
for entry in "${SETS[@]}"; do tar xzf "${entry}.tar.gz"; done

echo
echo "Done. Next: node scripts/corpus/make-corpus-manifest.mjs ${DEST}"
echo "NOTE: these archives are gitignored. What is committed is the SHA-256 pins in verify-archive.mjs"
echo "      and the manifest — the checksum is the corpus\x27s identity, the bytes are just its size."
