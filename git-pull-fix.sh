#!/bin/bash
set -e

echo "🔄 Starting git pull..."
git pull

echo "🧹 Cleaning and reinstalling for local ARM64 Mac..."
rm -rf node_modules
pnpm install

echo "🔧 Installing ARM64 native binaries..."
pnpm add -D @rollup/rollup-darwin-arm64 @esbuild/darwin-arm64 @tailwindcss/oxide-darwin-arm64

echo "✅ Ready! Run: pnpm dev"
