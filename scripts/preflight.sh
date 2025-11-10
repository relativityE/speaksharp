#!/bin/bash
# Canonical Preflight Script (v3)
# Purpose: Perform lightweight, essential-only checks.
# This script is designed to be fast and idempotent.
set -e

echo "✅ [Preflight] Starting environment sanity checks..."

# Check 1: Node.js version
# Must match the version in the .github/workflows/ci.yml
node --version | grep "v22." > /dev/null || (echo "❌ FATAL: Incorrect Node.js version. Expected v22." && exit 1)
echo "✅ [Preflight] Node.js version is correct."

# Check 2: pnpm is installed and accessible
pnpm --version > /dev/null || (echo "❌ FATAL: pnpm is not installed or not in PATH." && exit 1)
echo "✅ [Preflight] pnpm is installed."

# Check 3: node_modules exists
# If it doesn't, the user needs to run 'pnpm setup' as per the README.
test -d "node_modules" || (echo "❌ FATAL: node_modules not found. Please run 'pnpm setup'." && exit 1)
echo "✅ [Preflight] Dependencies are installed."

echo "✅ [Preflight] Environment sanity checks passed."
