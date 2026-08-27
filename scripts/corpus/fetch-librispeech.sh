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

# Expected byte counts. A mismatch means the upstream artifact changed and the pinned checksums no
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

echo "==> recording SHA-256 (the corpus's real identity)"
if command -v sha256sum >/dev/null 2>&1; then
    sha256sum ./*.tar.gz > CHECKSUMS
else
    shasum -a 256 ./*.tar.gz > CHECKSUMS   # macOS
fi
cat CHECKSUMS

echo "==> extracting"
for entry in "${SETS[@]}"; do tar xzf "${entry%%:*}.tar.gz"; done

echo
echo "Done. Next: node scripts/corpus/make-corpus-manifest.mjs ${DEST}"
echo "NOTE: these archives are gitignored. Only CHECKSUMS content and the manifest are committed."
