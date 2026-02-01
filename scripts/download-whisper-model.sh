#!/bin/bash

# ============================================================================
# WHISPER MODEL DOWNLOADER
# ============================================================================
#
# PURPOSE:
# --------
# Downloads the Whisper Tiny model (quantized) and tokenizer files required
# for On-Device speech transcription. These files enable the app to run
# Whisper AI locally in the browser using WebAssembly.
#
# WHY THIS IS NEEDED:
# -------------------
# The On-Device transcription mode uses whisper-turbo to run Whisper models
# directly in the browser. The model files are NOT bundled with the app
# because they're too large (30MB). Instead, they're:
#   1. Downloaded once using this script
#   2. Placed in public/models/ directory
#   3. Served as static assets by Vite
#   4. Cached by the service worker (sw.js) for instant subsequent loads
#
# FILES DOWNLOADED:
# -----------------
# 1. tiny-q8g16.bin (30MB)
#    - Quantized Whisper Tiny model optimized for browser inference
#    - Source: https://rmbl.us/whisper-turbo/
#    - Model: whisper-tiny.en (English-only, fastest)
#
# 2. tokenizer.json (2MB)
#    - Whisper tokenizer configuration
#    - Source: Hugging Face (openai/whisper-large-v2)
#    - Required for text encoding/decoding
#
# USAGE:
# ------
# Run this script from the project root:
#
#   $ ./scripts/download-whisper-model.sh
#
# Or via pnpm (if defined in package.json):
#
#   $ pnpm download:whisper-model
#
# The script will:
#   - Create frontend/public/models/ directory
#   - Download both files (only if not already present)
#   - Show file sizes for verification
#
# WHEN TO RUN:
# ------------
# - Initial project setup (after pnpm install)
# - After clearing public/models/ directory
# - When upgrading to a new Whisper model version
#
# VERIFICATION:
# -------------
# After running, you should see:
#
#   $ ls -lh frontend/public/models/
#   -rw-r--r-- tiny-q8g16.bin     (~30MB)
#   -rw-r--r-- tokenizer.json     (~2MB)
#
# INTEGRATION WITH SERVICE WORKER:
# ---------------------------------
# The sw.js service worker will intercept requests for these files and serve
# them from the local /models/ path instead of downloading from the CDN.
# This reduces load time from 30+ seconds to <1 second on subsequent uses.
#
# TROUBLESHOOTING:
# ----------------
# - If download fails: Check internet connection and CDN availability
# - If files are corrupted: Delete and re-run this script
# - If service worker doesn't cache: Clear browser cache and reload
#
# RELATED FILES:
# --------------
# - frontend/public/sw.js: Service worker that caches these models
# - frontend/src/services/transcription/modes/OnDeviceWhisper.ts: Uses these models
# - docs/ARCHITECTURE.md: Full documentation on model caching strategy
#
# ============================================================================


# Directory to store the model assets
OUTPUT_DIR="frontend/public/models"
mkdir -p "$OUTPUT_DIR"

echo "Downloading Whisper model assets to $OUTPUT_DIR..."

# 1. Download the quantized model binary (tiny)
# URL derived from whisper-turbo source: https://rmbl.us/whisper-turbo/tiny-q8g16.bin
# AvailableModels.WHISPER_TINY maps to "tiny", so we need "tiny-q8g16.bin"
MODEL_URL="https://rmbl.us/whisper-turbo/tiny-q8g16.bin"
MODEL_FILE="$OUTPUT_DIR/tiny-q8g16.bin"

if [ -f "$MODEL_FILE" ]; then
    echo "Model file already exists: $MODEL_FILE"
else
    echo "Downloading model binary..."
    curl -L "$MODEL_URL" -o "$MODEL_FILE"
fi

# 2. Download the tokenizer configuration
# URL derived from whisper-turbo source: https://huggingface.co/openai/whisper-large-v2/raw/main/tokenizer.json
TOKENIZER_URL="https://huggingface.co/openai/whisper-large-v2/raw/main/tokenizer.json"
TOKENIZER_FILE="$OUTPUT_DIR/tokenizer.json"

if [ -f "$TOKENIZER_FILE" ]; then
    echo "Tokenizer file already exists: $TOKENIZER_FILE"
else
    echo "Downloading tokenizer..."
    curl -L "$TOKENIZER_URL" -o "$TOKENIZER_FILE"
fi

echo "Download complete."
ls -lh "$OUTPUT_DIR"
