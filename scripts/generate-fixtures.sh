#!/usr/bin/env bash
set -euo pipefail

FIXTURE_DIR="tests/fixtures"
mkdir -p "$FIXTURE_DIR"

# Check tools
command -v ffmpeg  >/dev/null || { echo "❌ ffmpeg not found"; exit 1; }
command -v espeak-ng >/dev/null 2>&1 || command -v say >/dev/null || {
    echo "❌ Need espeak-ng (Linux) or say (macOS)"; exit 1;
}

speak() {
    local text="$1" out="$2"
    if command -v say >/dev/null 2>&1; then
        say -r 140 -v Alex "$text" -o "${out}.aiff"
        ffmpeg -y -i "${out}.aiff" -ar 16000 -ac 1 -acodec pcm_s16le "$out" 2>/dev/null
        rm "${out}.aiff"
    else
        espeak-ng -s 140 -w "${out}.raw.wav" "$text"
        ffmpeg -y -i "${out}.raw.wav" -ar 16000 -ac 1 -acodec pcm_s16le "$out" 2>/dev/null
        rm "${out}.raw.wav"
    fi
}

speak "The birch canoe slid on the smooth planks." \
    "$FIXTURE_DIR/harvard_01_16k.wav"

speak "The birch canoe slid on the smooth planks. \
       Glue the sheet to the dark blue background. \
       It is easy to tell the depth of a well. \
       These days a chicken leg is a rare dish. \
       Rice is often served in round bowls." \
    "$FIXTURE_DIR/harvard_sentences_16k.wav"

speak "The birch canoe slid on the smooth planks. \
       Glue the sheet to the dark blue background. \
       It is easy to tell the depth of a well. \
       These days a chicken leg is a rare dish. \
       Rice is often served in round bowls. \
       The juice of lemons makes fine punch. \
       The box was thrown beside the parked truck. \
       The hogs were fed chopped corn and garbage. \
       Four hours of steady work faced us. \
       Large size in stockings is hard to sell." \
    "$FIXTURE_DIR/harvard_benchmark_16k.wav"

echo "✅ Fixtures generated. Validating..."
for f in "$FIXTURE_DIR"/harvard_*.wav; do
    result=$(ffprobe -v quiet -print_format json -show_streams "$f" \
        | python3 -c "import sys,json; s=json.load(sys.stdin)['streams'][0]; \
          print(s['sample_rate'], s['channels'], s['codec_name'])")
    if [[ "$result" == "16000 1 pcm_s16le" ]]; then
        echo "  ✅ $f"
    else
        echo "  ❌ $f — got: $result (expected: 16000 1 pcm_s16le)"
        exit 1
    fi
done
