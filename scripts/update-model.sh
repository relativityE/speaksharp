#!/bin/bash
#
# scripts/update-model.sh
#
# This script automates the process of downloading and updating on-device
# transcription models from the Hugging Face Hub.
#
# Usage:
# ./scripts/update-model.sh <model_name>
#
# Example:
# ./scripts/update-model.sh Xenova/whisper-tiny.en
#

set -e # Exit immediately if a command exits with a non-zero status.

# --- Configuration ---
BASE_URL="https://huggingface.co"
DEST_BASE_DIR="public/models"
# List of files required by the @xenova/transformers library for a standard model.
# The main model file itself is typically in an 'onnx' subdirectory.
FILES_TO_DOWNLOAD=(
    "config.json"
    "tokenizer.json"
    "tokenizer_config.json"
    "onnx/model.onnx"
)

# --- Argument Validation ---
if [ -z "$1" ]; then
    echo "❌ Error: Model name not provided."
    echo "Usage: $0 <model_name>"
    echo "Example: $0 Xenova/whisper-tiny.en"
    exit 1
fi

MODEL_NAME=$1
# Extract the part after the slash for the directory name, e.g., "whisper-tiny.en"
MODEL_DIR_NAME=$(echo "$MODEL_NAME" | cut -d'/' -f2)
DEST_DIR="$DEST_BASE_DIR/$MODEL_DIR_NAME"

echo "🚀 Starting model update for: $MODEL_NAME"
echo "   Destination directory: $DEST_DIR"

# --- Pre-flight Checks ---
if ! command -v curl &> /dev/null; then
    echo "❌ Error: curl is not installed. Please install it to continue."
    exit 1
fi

# --- Execution ---
echo "1. Preparing destination directory..."
# Remove the old directory if it exists, and create a fresh one.
if [ -d "$DEST_DIR" ]; then
    echo "   -> Found existing directory. Removing for a clean install."
    rm -rf "$DEST_DIR"
fi
mkdir -p "$DEST_DIR"
echo "   -> Directory created."

# Create the 'onnx' subdirectory needed for the model file.
mkdir -p "$DEST_DIR/onnx"
echo "   -> 'onnx' subdirectory created."

echo "2. Downloading model files..."
for file in "${FILES_TO_DOWNLOAD[@]}"; do
    url="$BASE_URL/$MODEL_NAME/resolve/main/$file"
    dest_path="$DEST_DIR/$file"
    echo "   -> Downloading $file..."
    # Use curl with -f to fail on server errors, -L to follow redirects, and -o to specify output file.
    if curl -fL "$url" -o "$dest_path"; then
        echo "      ✅ Download successful."
    else
        echo "      ❌ Error: Failed to download $file from $url"
        # Clean up the partially created directory on failure.
        rm -rf "$DEST_DIR"
        exit 1
    fi
done

echo "🎉 Model update complete!"
echo "The model '$MODEL_NAME' is now available in '$DEST_DIR'."
# Make the script executable
chmod +x scripts/update-model.sh
