#!/usr/bin/env bash
# #1304 Task 4 — build ONE >30s concatenated fixture.
#
# WHY THIS EXISTS. Ordinary LibriSpeech utterances are a few seconds long, so they all take the
# ZERO-stride branch (`audioSeconds < WHISPER_WINDOW_SECONDS`). The 5-second long-form stride would
# therefore never execute while appearing covered — the corpus alone cannot exercise it. Without a
# deliberate >30s input, half the shipping decode path goes unmeasured.
#
# Utterances come from ONE chapter so the result is a plausible continuous passage rather than a
# collage of voices, and the reference is the concatenation of their transcripts in the same order.
#
# ffmpeg ONLY. The first version also required `sox`, which is not installed here and is not needed:
# ffmpeg's concat demuxer joins the decoded WAVs and ffprobe reports the duration. A second required
# tool is a second way for this to be unrunnable.
set -euo pipefail

# Sorting decides WHICH utterances land in the fixture, so it must not depend on the machine's locale.
export LC_ALL=C

# Absolute paths BEFORE any directory change (see fetch-librispeech.sh for why this is a rule here).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

CORPUS="$(cd "${1:-bench-corpus}" && pwd)"
OUT="${2:-${REPO_ROOT}/tests/fixtures/corpus-longform}"
SET="test-clean"

command -v ffmpeg  >/dev/null 2>&1 || { echo "FATAL: ffmpeg is required (brew install ffmpeg)" >&2; exit 1; }
command -v ffprobe >/dev/null 2>&1 || { echo "FATAL: ffprobe is required (ships with ffmpeg)" >&2; exit 1; }

SRC_DIR="${CORPUS}/LibriSpeech/${SET}"
[ -d "$SRC_DIR" ] || { echo "FATAL: ${SRC_DIR} missing — run fetch-librispeech.sh first" >&2; exit 1; }

# The fixture is only as trustworthy as the corpus it is cut from, so require the archive to pass
# PINNED verification first. Otherwise a fixture built from a corrupted extraction would carry its own
# clean-looking checksum and nothing would ever contradict it.
node "${SCRIPT_DIR}/verify-archive.mjs" "${CORPUS}/${SET}.tar.gz" "${SET}.tar.gz" >/dev/null || {
    echo "FATAL: ${SET}.tar.gz failed pinned verification — refusing to build a fixture from it." >&2
    exit 1
}

mkdir -p "$OUT"

# First chapter in sorted order. Deterministic: never "any".
CHAPTER_DIR="$(find "$SRC_DIR" -mindepth 2 -maxdepth 2 -type d | sort | head -1)"
TRANS="$(find "$CHAPTER_DIR" -name '*.trans.txt' | sort | head -1)"
[ -n "$TRANS" ] || { echo "FATAL: no transcript file under ${CHAPTER_DIR}" >&2; exit 1; }

# Enough utterances to clear 30s with margin; the duration gate below is the real check.
# `mapfile` is bash 4+; macOS ships bash 3.2, where it silently does not exist. Read the loop instead
# so this script runs on a developer machine and not only in CI.
IDS=()
while IFS= read -r line; do IDS+=("$line"); done < <(cut -d' ' -f1 "$TRANS" | sort | head -6)
[ "${#IDS[@]}" -eq 6 ] || { echo "FATAL: fewer than 6 utterances in ${CHAPTER_DIR}" >&2; exit 1; }

CONCAT_LIST="$(mktemp)"
trap 'rm -f "$CONCAT_LIST"' EXIT
: > "$OUT/long-01.reference.txt"
WAVS=()
for id in "${IDS[@]}"; do
    ffmpeg -loglevel error -y -i "${CHAPTER_DIR}/${id}.flac" -ar 16000 -ac 1 "${OUT}/${id}.wav"
    WAVS+=("${OUT}/${id}.wav")
    printf "file '%s'\n" "${OUT}/${id}.wav" >> "$CONCAT_LIST"
    grep "^${id} " "$TRANS" | cut -d' ' -f2- >> "$OUT/long-01.reference.txt"
done

ffmpeg -loglevel error -y -f concat -safe 0 -i "$CONCAT_LIST" -ar 16000 -ac 1 "$OUT/long-01.wav"
rm -f "${WAVS[@]}"

# Fail closed if the result is not actually long-form — crossing the 30s window IS the point.
DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/long-01.wav")"
python3 - "$DURATION" <<'PY'
import sys
d = float(sys.argv[1])
print(f"duration: {d:.2f}s")
if d <= 30.0:
    print("FATAL: fixture is <= 30s — it would take the ZERO-stride branch, which the ordinary corpus "
          "already covers. Add more utterances.", file=sys.stderr)
    raise SystemExit(1)
PY

# The WAV is COMMITTED, not regenerated on demand. Encoder output is not guaranteed byte-identical
# across ffmpeg versions, so a "rebuild it yourself" fixture would hand different arms subtly
# different audio while the CHECKSUMS file appeared to guarantee the opposite. 1.2 MB in git buys an
# unambiguous shared input. The ffmpeg build that produced it is recorded in PROVENANCE.
FFMPEG_VERSION="$(ffmpeg -version | head -1)"

# Freeze both halves. This digest IS self-computed — legitimately so: unlike the LibriSpeech archives,
# this artifact is ours, so there is no publisher value to check it against. What makes it meaningful
# is that its INPUTS were pin-verified above; the freeze then detects drift from here on.
SHA_CMD=(shasum -a 256)
command -v sha256sum >/dev/null 2>&1 && SHA_CMD=(sha256sum)
( cd "$OUT" && "${SHA_CMD[@]}" long-01.wav long-01.reference.txt > CHECKSUMS )
cat "$OUT/CHECKSUMS"

{
    echo "fixture: long-01 (#1304 long-form decode branch)"
    echo "source set: ${SET} (LibriSpeech, CC BY 4.0)"
    echo "attribution: LibriSpeech ASR corpus, Panayotov et al., ICASSP 2015. https://www.openslr.org/12/"
    echo "archive verified: ${SET}.tar.gz passed pinned verification before this fixture was cut"
    echo "chapter: ${CHAPTER_DIR#"${CORPUS}/"}"
    echo "utterances (in order): ${IDS[*]}"
    echo "duration seconds: ${DURATION}"
    echo "built with: ${FFMPEG_VERSION}"
    echo "note: long-01.wav is COMMITTED. Regenerating with a different ffmpeg build may produce"
    echo "      different bytes; in that case the committed file, not the rebuild, is authoritative."
} > "$OUT/PROVENANCE"
cat "$OUT/PROVENANCE"
