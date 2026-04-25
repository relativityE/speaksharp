#!/usr/bin/env bash
set -euo pipefail

FIXTURE_DIR="tests/fixtures/stt-isomorphic/audio"
mkdir -p "$FIXTURE_DIR"

# Check tools
command -v ffmpeg  >/dev/null || { echo "❌ ffmpeg not found"; exit 1; }
command -v espeak-ng >/dev/null 2>&1 || command -v say >/dev/null || {
    echo "❌ Need espeak-ng (Linux) or say (macOS)"; exit 1;
}

speak() {
    local text="$1" out="$2"
    if command -v say >/dev/null 2>&1; then
        # 'say' on macOS. Adding natural pauses with [[slnc]] for stuttering effect if needed, 
        # but basic punctuation usually works well.
        say -r 140 -v Alex "$text" -o "${out}.aiff"
        ffmpeg -y -i "${out}.aiff" -ar 16000 -ac 1 -acodec pcm_s16le "$out" 2>/dev/null
        rm "${out}.aiff"
    else
        espeak-ng -s 140 -w "${out}.raw.wav" "$text"
        ffmpeg -y -i "${out}.raw.wav" -ar 16000 -ac 1 -acodec pcm_s16le "$out" 2>/dev/null
        rm "${out}.raw.wav"
    fi
}

echo "📢 Generating Acoustic Filler Word Ground Truths..."

speak "Um. Basically, we should literally like, wait." \
    "$FIXTURE_DIR/conv_01.wav"

speak "Well, I mean, you know, it is what it is." \
    "$FIXTURE_DIR/conv_02.wav"

echo "✅ Filler fixtures generated. Validating..."
for f in "$FIXTURE_DIR"/conv_*.wav; do
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
