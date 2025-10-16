#!/bin/bash
set -euo pipefail

echo "--- Running Unified Environment Setup ---"

echo "🔹 Installing Node.js dependencies..."
pnpm install

echo "🔹 Installing Playwright browsers and system dependencies..."
pnpm exec playwright install --with-deps

# Create a marker file to indicate that setup is complete, for scripts that might need it.
mkdir -p ./logs
touch ./logs/.env-setup-complete

echo "✅ Environment setup complete."
