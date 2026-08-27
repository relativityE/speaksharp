#!/usr/bin/env bash
# #1304 Task 4 — build ONE >30s concatenated fixture.
#
# WHY THIS EXISTS. Ordinary LibriSpeech utterances are a few seconds long, so they all take the
# ZERO-stride branch (`audioSeconds < WHISPER_WINDOW_SECONDS`). The 5-second long-form stride would
# therefore never execute while appearing covered — the corpus alone cannot exercise it. Without a
# deliberate >30s input, half the shipping decode path goes unmeasured.
#
# Utterances are taken from ONE speaker so the result is a plausible continuous passage rather than a
# collage of different voices, and the reference is the concatenation of their transcripts in the same
# order. Both the audio and the reference are then frozen by checksum.
set -euo pipefail

CORPUS="${1:-bench-corpus}"
OUT="${2:-tests/fixtures/corpus-longform}"
SET="test-clean"

command -v sox >/dev/null 2>&1 || { echo "FATAL: sox is required (brew install sox / apt install sox)" >&2; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "FATAL: ffmpeg is required to decode flac" >&2; exit 1; }

SRC_DIR="${CORPUS}/LibriSpeech/${SET}"
[ -d "$SRC_DIR" ] || { echo "FATAL: ${SRC_DIR} missing — run fetch-librispeech.sh first" >&2; exit 1; }

mkdir -p "$OUT"

# First speaker/chapter with enough material. Deterministic: first by sorted order, never "any".
CHAPTER_DIR="$(find "$SRC_DIR" -mindepth 2 -maxdepth 2 -type d | sort | head -1)"
TRANS="$(find "$CHAPTER_DIR" -name '*.trans.txt' | sort | head -1)"
[ -n "$TRANS" ] || { echo "FATAL: no transcript file under ${CHAPTER_DIR}" >&2; exit 1; }

# Take the first 5 utterances in sorted id order.
mapfile -t IDS < <(cut -d' ' -f1 "$TRANS" | sort | head -5)
[ "${#IDS[@]}" -eq 5 ] || { echo "FATAL: fewer than 5 utterances in ${CHAPTER_DIR}" >&2; exit 1; }

WAVS=()
: > "$OUT/long-01.reference.txt"
for id in "${IDS[@]}"; do
    ffmpeg -loglevel error -y -i "${CHAPTER_DIR}/${id}.flac" -ar 16000 -ac 1 "${OUT}/${id}.wav"
    WAVS+=("${OUT}/${id}.wav")
    grep "^${id} " "$TRANS" | cut -d' ' -f2- >> "$OUT/long-01.reference.txt"
done

sox "${WAVS[@]}" "$OUT/long-01.wav"
rm -f "${WAVS[@]}"

# Fail closed if the result is not actually long-form — the whole point is crossing the 30s window.
DURATION="$(sox --i -D "$OUT/long-01.wav")"
python3 - "$DURATION" <<'PY'
import sys
d = float(sys.argv[1])
print(f"duration: {d:.2f}s")
if d <= 30.0:
    print("FATAL: fixture is <= 30s — it would take the ZERO-stride branch, which is the branch "
          "the ordinary corpus already covers. Add more utterances.", file=sys.stderr)
    raise SystemExit(1)
PY

# Freeze both halves: audio and reference. A reference that drifts from its audio is unusable evidence.
if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$OUT/long-01.wav" "$OUT/long-01.reference.txt" > "$OUT/CHECKSUMS"
else
    shasum -a 256 "$OUT/long-01.wav" "$OUT/long-01.reference.txt" > "$OUT/CHECKSUMS"
fi
cat "$OUT/CHECKSUMS"
printf '%s\n' "utterances: ${IDS[*]}" > "$OUT/PROVENANCE"
echo "source set: ${SET} (LibriSpeech, CC BY 4.0)" >> "$OUT/PROVENANCE"
cat "$OUT/PROVENANCE"
