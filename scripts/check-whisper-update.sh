#!/bin/bash

# ============================================================================
# WHISPER MODEL VERSION CHECKER & UPDATER
# ============================================================================
#
# PURPOSE:
# --------
# Checks if a newer Whisper model is available and updates the local cache.
# This script should be run periodically (e.g., before releases) to ensure
# users get the latest model improvements.
#
# HOW IT WORKS:
# -------------
# 1. Reads current model version from manifest.json
# 2. Fetches latest version info from CDN
# 3. Compares versions
# 4. If newer: Downloads new model, updates manifest, prompts to bump SW cache
#
# USAGE:
# ------
#   ./scripts/check-whisper-update.sh [--force]
#
#   --force   Download even if versions match (useful for corruption recovery)
#
# VERSIONING STRATEGY:
# --------------------
# - Models are identified by their filename (e.g., tiny-q8g16.bin)
# - We use file size + last-modified date as a "version" proxy
# - When a new model is detected, we update manifest.json
# - Developer must manually bump MODEL_CACHE_NAME in sw.js to invalidate
#
# FILES:
# ------
# - frontend/public/models/manifest.json - Local version tracking
# - frontend/public/models/tiny-q8g16.bin - Whisper model binary
# - frontend/public/models/tokenizer.json - Tokenizer config
# - frontend/public/sw.js - Service Worker (update MODEL_CACHE_NAME for new version)
#
# ============================================================================

set -e

# Configuration
OUTPUT_DIR="frontend/public/models"
MANIFEST_FILE="$OUTPUT_DIR/manifest.json"
SW_FILE="frontend/public/sw.js"

# Model URLs (same as download script)
MODEL_URL="https://rmbl.us/whisper-turbo/tiny-q8g16.bin"
TOKENIZER_URL="https://huggingface.co/openai/whisper-large-v2/raw/main/tokenizer.json"

# Force flag
FORCE_UPDATE=false
if [ "$1" == "--force" ]; then
    FORCE_UPDATE=true
    echo "Force update enabled"
fi

# Create output directory if needed
mkdir -p "$OUTPUT_DIR"

# Initialize manifest if it doesn't exist
if [ ! -f "$MANIFEST_FILE" ]; then
    echo "Creating initial manifest..."
    cat > "$MANIFEST_FILE" << EOF
{
  "version": "1.0.0",
  "lastChecked": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "models": {
    "tiny-q8g16.bin": {
      "url": "$MODEL_URL",
      "size": 0,
      "lastModified": null
    },
    "tokenizer.json": {
      "url": "$TOKENIZER_URL",
      "size": 0,
      "lastModified": null
    }
  }
}
EOF
fi

echo "Checking for Whisper model updates..."
echo "========================================"

# Function to get remote file info via HEAD request
get_remote_info() {
    local url=$1
    local info=$(curl -sI "$url" 2>/dev/null)
    local size=$(echo "$info" | grep -i "content-length" | awk '{print $2}' | tr -d '\r')
    local modified=$(echo "$info" | grep -i "last-modified" | cut -d' ' -f2- | tr -d '\r')
    echo "$size|$modified"
}

# Function to get local file info
get_local_info() {
    local file=$1
    if [ -f "$file" ]; then
        local size=$(stat -f%z "$file" 2>/dev/null || stat --printf="%s" "$file" 2>/dev/null)
        echo "$size"
    else
        echo "0"
    fi
}

# Check model file
echo ""
echo "Checking model: tiny-q8g16.bin"
echo "------------------------------"

MODEL_FILE="$OUTPUT_DIR/tiny-q8g16.bin"
LOCAL_SIZE=$(get_local_info "$MODEL_FILE")
REMOTE_INFO=$(get_remote_info "$MODEL_URL")
REMOTE_SIZE=$(echo "$REMOTE_INFO" | cut -d'|' -f1)
REMOTE_MODIFIED=$(echo "$REMOTE_INFO" | cut -d'|' -f2-)

echo "Local size:    $LOCAL_SIZE bytes"
echo "Remote size:   $REMOTE_SIZE bytes"
echo "Last modified: $REMOTE_MODIFIED"

MODEL_NEEDS_UPDATE=false
if [ "$FORCE_UPDATE" = true ]; then
    MODEL_NEEDS_UPDATE=true
    echo "Status: FORCE UPDATE"
elif [ "$LOCAL_SIZE" = "0" ]; then
    MODEL_NEEDS_UPDATE=true
    echo "Status: NOT FOUND - will download"
elif [ -n "$REMOTE_SIZE" ] && [ "$LOCAL_SIZE" != "$REMOTE_SIZE" ]; then
    MODEL_NEEDS_UPDATE=true
    echo "Status: SIZE MISMATCH - update available!"
else
    echo "Status: UP TO DATE"
fi

# Check tokenizer file
echo ""
echo "Checking tokenizer: tokenizer.json"
echo "-----------------------------------"

TOKENIZER_FILE="$OUTPUT_DIR/tokenizer.json"
LOCAL_TOKEN_SIZE=$(get_local_info "$TOKENIZER_FILE")
REMOTE_TOKEN_INFO=$(get_remote_info "$TOKENIZER_URL")
REMOTE_TOKEN_SIZE=$(echo "$REMOTE_TOKEN_INFO" | cut -d'|' -f1)

echo "Local size:  $LOCAL_TOKEN_SIZE bytes"
echo "Remote size: $REMOTE_TOKEN_SIZE bytes"

TOKENIZER_NEEDS_UPDATE=false
if [ "$FORCE_UPDATE" = true ]; then
    TOKENIZER_NEEDS_UPDATE=true
    echo "Status: FORCE UPDATE"
elif [ "$LOCAL_TOKEN_SIZE" = "0" ]; then
    TOKENIZER_NEEDS_UPDATE=true
    echo "Status: NOT FOUND - will download"
elif [ -n "$REMOTE_TOKEN_SIZE" ] && [ "$LOCAL_TOKEN_SIZE" != "$REMOTE_TOKEN_SIZE" ]; then
    TOKENIZER_NEEDS_UPDATE=true
    echo "Status: SIZE MISMATCH - update available!"
else
    echo "Status: UP TO DATE"
fi

# Update files if needed
echo ""
echo "========================================"

if [ "$MODEL_NEEDS_UPDATE" = true ]; then
    echo "Downloading updated model..."
    curl -L --progress-bar "$MODEL_URL" -o "$MODEL_FILE"
    echo "✅ Model updated"
fi

if [ "$TOKENIZER_NEEDS_UPDATE" = true ]; then
    echo "Downloading updated tokenizer..."
    curl -L --progress-bar "$TOKENIZER_URL" -o "$TOKENIZER_FILE"
    echo "✅ Tokenizer updated"
fi

# Update manifest
if [ "$MODEL_NEEDS_UPDATE" = true ] || [ "$TOKENIZER_NEEDS_UPDATE" = true ]; then
    NEW_MODEL_SIZE=$(get_local_info "$MODEL_FILE")
    NEW_TOKEN_SIZE=$(get_local_info "$TOKENIZER_FILE")
    
    cat > "$MANIFEST_FILE" << EOF
{
  "version": "1.0.0",
  "lastChecked": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "lastUpdated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "models": {
    "tiny-q8g16.bin": {
      "url": "$MODEL_URL",
      "size": $NEW_MODEL_SIZE,
      "lastModified": "$REMOTE_MODIFIED"
    },
    "tokenizer.json": {
      "url": "$TOKENIZER_URL",
      "size": $NEW_TOKEN_SIZE,
      "lastModified": null
    }
  }
}
EOF
    
    echo ""
    echo "⚠️  IMPORTANT: Model files were updated!"
    echo ""
    echo "To invalidate user caches, bump the version in sw.js:"
    echo ""
    echo "  Current: const MODEL_CACHE_NAME = 'whisper-models-v1';"
    echo "  Change:  const MODEL_CACHE_NAME = 'whisper-models-v2';"
    echo ""
    echo "Edit: $SW_FILE"
    echo ""
else
    # Just update lastChecked
    cat > "$MANIFEST_FILE" << EOF
{
  "version": "1.0.0",
  "lastChecked": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "models": {
    "tiny-q8g16.bin": {
      "url": "$MODEL_URL",
      "size": $LOCAL_SIZE,
      "lastModified": "$REMOTE_MODIFIED"
    },
    "tokenizer.json": {
      "url": "$TOKENIZER_URL",
      "size": $LOCAL_TOKEN_SIZE,
      "lastModified": null
    }
  }
}
EOF
    echo "✅ All models are up to date"
fi

echo ""
echo "Summary:"
ls -lh "$OUTPUT_DIR"
