#!/bin/bash

# Git Pull & Architecture Fix Script
# Handles git pull and resolves ARM64/x64 architecture conflicts automatically

set -e  # Exit on any error

echo "🔄 Starting git pull with architecture fix..."

# Step 1: Git pull
echo "📥 Pulling latest changes from remote..."
git pull

# Step 2: Check if package.json changed
if git diff --name-only HEAD~1 HEAD | grep -q "package.json\|pnpm-lock.yaml"; then
    echo "📦 Package changes detected, updating dependencies..."
    
    # Step 3: Clean and reinstall
    echo "🧹 Cleaning node_modules and lockfile..."
    rm -rf node_modules pnpm-lock.yaml
    
    # Step 4: Install dependencies
    echo "⬇️  Installing dependencies..."
    pnpm install
    
    # Step 5: Add ARM64 binaries for local development
    echo "🔧 Adding ARM64 native binaries for local Mac development..."
    pnpm add -D @rollup/rollup-darwin-arm64 @esbuild/darwin-arm64
    
    # --- Step 5b: Ensure LightningCSS native module exists for ARM64 ---
    LIGHTNINGCSS_BIN="node_modules/lightningcss/node/lightningcss.darwin-arm64.node"
    if [ ! -f "$LIGHTNINGCSS_BIN" ]; then
      echo "⚠️  Missing LightningCSS ARM64 binary detected. Rebuilding..."
      pnpm rebuild lightningcss
      if [ ! -f "$LIGHTNINGCSS_BIN" ]; then
        echo "❌ LightningCSS binary rebuild failed. Please check pnpm setup or architecture conflicts."
        exit 1
      else
        echo "✅ LightningCSS ARM64 binary successfully rebuilt."
      fi
    fi

    echo "✅ Dependencies updated and ARM64 binaries installed!"
else
    echo "📦 No package changes detected, skipping dependency update"
fi

# Step 6: Test if dev server can start
echo "🚀 Testing dev server startup..."
timeout 10s pnpm dev > /dev/null 2>&1 && echo "✅ Dev server test passed!" || {
    echo "⚠️  Dev server test failed - you may need to check for additional native binary conflicts"
    echo "💡 Try running 'pnpm dev' manually to see specific errors"
}

echo ""
echo "🎉 Git pull and setup complete!"
echo "📋 Next steps:"
echo "   • Run 'pnpm dev' to start development server"
echo "   • Run 'pnpm test:e2e' to test Playwright (after addressing mock services)"
echo ""
