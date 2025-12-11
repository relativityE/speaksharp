#!/bin/bash

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
