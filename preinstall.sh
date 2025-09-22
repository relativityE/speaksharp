#!/bin/bash
# preinstall.sh - Restore lockfile and install dependencies

set -euxo pipefail

echo "📦 Starting preinstall: restoring lockfile and dependencies..."

# If lockfile is missing, regenerate it
if [ ! -f pnpm-lock.yaml ]; then
    echo "⚠️ pnpm-lock.yaml missing. Regenerating..."
    pnpm install
else
    echo "✅ Lockfile exists. Installing dependencies..."
    pnpm install --frozen-lockfile
fi

# Confirm node_modules populated
if [ ! -d "node_modules" ] || [ "$(ls -A node_modules | wc -l)" -eq 0 ]; then
    echo "❌ node_modules missing or empty after install"
    exit 1
fi

echo "✅ Dependencies ready"
