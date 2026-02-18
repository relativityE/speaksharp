#!/bin/bash

echo "🔍 Verifying build contains your changes..."

BUILD_DIR="frontend/dist"

# Check if dist exists
if [ ! -d "$BUILD_DIR" ]; then
  echo "❌ ERROR: $BUILD_DIR does not exist!"
  exit 1
fi

# Check if index.html exists
if [ ! -f "$BUILD_DIR/index.html" ]; then
  echo "❌ ERROR: index.html not found in dist!"
  exit 1
fi

# Check timestamp (should be recent)
BUILD_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$BUILD_DIR/index.html" 2>/dev/null || stat -c "%y" "$BUILD_DIR/index.html" 2>/dev/null)
echo "📅 Build timestamp: $BUILD_TIME"

# Check for your debug markers
echo "🔍 Checking for E2E_DEBUG logs in build..."
if grep -r "E2E_DEBUG" "$BUILD_DIR/assets/"*.js > /dev/null; then
  echo "✅ Found E2E_DEBUG in build"
else
  echo "⚠️  WARNING: E2E_DEBUG not found in build"
  echo "This might be normal if logs are stripped, but verify your changes are included"
fi

# Check for specific string from your changes
echo "🔍 Checking for 'Recording active' in build..."
if grep -r "Recording active" "$BUILD_DIR/assets/"*.js > /dev/null; then
  echo "✅ Found 'Recording active' in build"
else
  echo "❌ ERROR: 'Recording active' not found in build!"
  echo "Your changes are NOT in the build!"
  exit 1
fi

echo "✅ Build verification passed"
