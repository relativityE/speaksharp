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

speak "The stale smell of old beer lingers." \
    "$FIXTURE_DIR/harvard_01_16k.wav"

speak "The stale smell of old beer lingers. \
       A dash of pepper spoils beef stew. \
       The swan dive was far short of perfect. \
       The box was thrown beside the parked truck. \
       The twister left no trace of the town." \
    "$FIXTURE_DIR/harvard_sentences_16k.wav"

speak "Um, the stale smell of old beer, like, lingers. \
       Basically, a dash of pepper spoils beef stew. \
       Well, the swan dive was far short of perfect. \
       You know, the box was thrown beside the parked truck. \
       Literally, the twister left no trace of the town. \
       They, like, told wild tales to frighten him. \
       We, um, find joy in the simplest things. \
       The puppy, like, chewed up the new shoes. \
       A smooth road, you know, makes driving pleasant. \
       Basically, the quick brown fox jumps over the lazy dog." \
    "$FIXTURE_DIR/harvard_benchmark_16k.wav"

# Loop the benchmark audio to create a 120s version
echo "🔄 Looping harvard_benchmark_16k.wav to create harvard_benchmark_16k_loop_120s.wav..."
ffmpeg -y -stream_loop -1 -i "$FIXTURE_DIR/harvard_benchmark_16k.wav" -t 120 "$FIXTURE_DIR/harvard_benchmark_16k_loop_120s.wav" 2>/dev/null

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
