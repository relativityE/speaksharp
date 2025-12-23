#!/usr/bin/env bash
set -euo pipefail

echo "🔄 Starting git pull..."

# Detect current branch
current_branch=$(git symbolic-ref --short HEAD)
echo "Current branch: $current_branch"

# Fetch latest changes from origin
git fetch origin

# Attempt pull with rebase for linear history
if git pull --rebase origin "$current_branch"; then
    echo "✅ Git pull with rebase succeeded."
else
    echo "⚠️ Rebase failed. Falling back to merge..."
    git pull --no-rebase origin "$current_branch"
    echo "✅ Git pull with merge succeeded."
fi

echo "🧹 Cleaning and reinstalling for local ARM64 Mac..."
rm -rf node_modules
pnpm install

echo "🔧 Installing ARM64 native binaries..."
pnpm add -D @rollup/rollup-darwin-arm64 @esbuild/darwin-arm64 @tailwindcss/oxide-darwin-arm64

echo "✅ Ready! Run: pnpm dev"

