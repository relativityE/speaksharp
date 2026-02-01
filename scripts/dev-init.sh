#!/bin/bash
set -euo pipefail

echo "--- Running Development Environment Initialization ---"

echo "🔹 1. Installing project dependencies (via canonical 'pnpm run setup')..."
pnpm run setup

echo "🔹 2. Installing Playwright browsers..."
pnpm pw:install:all

echo "✅ Development environment initialized."
echo "You can now run 'pnpm dev' to start the server."
