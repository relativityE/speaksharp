#!/bin/bash
# scripts/preflight.sh - Fast environment validation only

set -euo pipefail

echo "🔍 Running preflight checks..."

# Check Node/pnpm installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm not found"
    exit 1
fi

# Check node_modules exists (don't install, just check)
if [ ! -d "node_modules" ]; then
    echo "❌ node_modules missing. Run: pnpm install"
    exit 1
fi

# Check required env files exist
if [ ! -f ".env.test" ]; then
    echo "❌ .env.test missing"
    exit 1
fi

echo "✅ Preflight checks passed"
