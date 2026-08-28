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

DEST="${1:-bench-corpus}"
BASE="https://www.openslr.org/resources/12"

# Byte counts and official MD5s are pinned in verify-archive.mjs (OpenSLR md5sum.txt, read 2026-08-27).
# longer describe what was downloaded — fail closed rather than proceed on a different corpus.
declare -a SETS=("test-clean:346663984" "test-other:328757843")

mkdir -p "$DEST"
cd "$DEST"

for entry in "${SETS[@]}"; do
    name="${entry%%:*}"
    expected_bytes="${entry##*:}"
    archive="${name}.tar.gz"

    if [ ! -f "$archive" ]; then
        echo "==> fetching ${archive}"
        curl -fL --retry 3 --continue-at - -o "$archive" "${BASE}/${archive}"
    else
        echo "==> ${archive} already present, skipping download"
    fi

    actual_bytes=$(wc -c < "$archive" | tr -d ' ')
    if [ "$actual_bytes" != "$expected_bytes" ]; then
        echo "FATAL: ${archive} is ${actual_bytes} bytes, expected ${expected_bytes}." >&2
        echo "       The upstream artifact changed. Re-pin deliberately; do not proceed." >&2
        exit 1
    fi
    echo "    size OK (${actual_bytes} bytes)"
done

echo "==> VERIFYING before extraction: byte count -> official MD5 -> SHA-256"
# Layered, and the ORDER is the point. A byte count cannot see corruption at the correct length, and a
# SHA-256 computed BEFORE the publisher's MD5 passes would pin whatever arrived — which is what the
# first version of this script did and then called a pin.
for entry in "${SETS[@]}"; do
    name="${entry%%:*}"
    node "$(dirname "$0")/verify-archive.mjs" "${name}.tar.gz" "${name}.tar.gz" || {
        echo "FATAL: ${name}.tar.gz failed integrity verification — NOT extracting." >&2
        exit 1
    }
done

echo "==> extracting"
for entry in "${SETS[@]}"; do tar xzf "${entry%%:*}.tar.gz"; done

echo
echo "Done. Next: node scripts/corpus/make-corpus-manifest.mjs ${DEST}"
echo "NOTE: these archives are gitignored. Only CHECKSUMS content and the manifest are committed."
