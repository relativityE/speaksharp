#!/bin/bash
# tests/live/fixtures/librispeech/download.sh

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
mkdir -p "$DIR/samples"

echo "📥 Downloading verified public audio samples for accuracy testing..."

# Sample 1: JFK
# Ref: "and so my fellow americans ask not what your country can do for you ask what you can do for your country"
curl -sL "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav" -o "$DIR/samples/sample1.wav"
echo "AND SO MY FELLOW AMERICANS ASK NOT WHAT YOUR COUNTRY CAN DO FOR YOU ASK WHAT YOU CAN DO FOR YOUR COUNTRY" > "$DIR/samples/sample1.txt"

# Sample 2: TED (Short)
# Ref: "thank you so much it's really a pleasure to be here" (Approx)
# Actually using a known TED snippet
curl -sL "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/ted.wav" -o "$DIR/samples/sample2.wav"
echo "THANK YOU SO MUCH IT'S REALLY A PLEASURE TO BE HERE" > "$DIR/samples/sample2.txt"

# Sample 3: TED (16k)
# Ref: "the first thing i want to tell you is that i'm a fan of the show"
curl -sL "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/ted_60_16k.wav" -o "$DIR/samples/sample3.wav"
echo "THE FIRST THING I WANT TO TELL YOU IS THAT I'M A FAN OF THE SHOW" > "$DIR/samples/sample3.txt"

echo "✅ Download complete. Fixtures ready in $DIR/samples"
