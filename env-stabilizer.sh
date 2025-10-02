#!/bin/bash
set -euo pipefail

echo "[stabilizer] 🔹 Aggressive environment cleanup..."

# Kill lingering processes
pkill -f 'node|vite|playwright' || true

# Verify critical ports are free
echo "[stabilizer] 🔹 Checking ports 5173, 9323..."
if lsof -iTCP:5173 -sTCP:LISTEN -t || lsof -iTCP:9323 -sTCP:LISTEN -t; then
  echo "[stabilizer] ❌ Ports still in use. Aborting."
  exit 1
fi

# Remove caches and temporary directories
echo "[stabilizer] 🔹 Clearing caches and build artifacts..."
rm -rf node_modules test-results coverage dist .cache .playwright node_modules/.vite
git reset --hard HEAD >/dev/null 2>&1
git clean -fdx >/dev/null 2>&1

# Sanity check
echo "[stabilizer] 🔹 Verifying shell works..."
echo "sanity-ok" | tee sanity.log

# Install dependencies using official dev setup
echo "[stabilizer] 🔹 Installing dependencies via pnpm setup:dev..."
if ! pnpm setup:dev; then
  echo "[stabilizer] ❌ Dependency setup failed. Aborting."
  exit 1
fi

# Optional Playwright hardening
echo "[stabilizer] 🔹 Temporarily adjusting Playwright config for isolated tests..."
PLAYWRIGHT_CONFIG="playwright.config.ts"
if [ -f "$PLAYWRIGHT_CONFIG" ]; then
  # Make a backup
  cp "$PLAYWRIGHT_CONFIG" "$PLAYWRIGHT_CONFIG.bak"
  # Patch config: workers=1, reuseExistingServer=false
  sed -i '' 's/workers:.*/workers: 1,/' "$PLAYWRIGHT_CONFIG" || true
  sed -i '' 's/reuseExistingServer:.*/reuseExistingServer: false,/' "$PLAYWRIGHT_CONFIG" || true
fi

# Basic vite dev sanity test (optional, short)
echo "[stabilizer] 🔹 Quick Vite dev sanity check..."
if ! timeout 60 pnpm run dev | tee vite-start.log | grep -q "ready in"; then
  echo "[stabilizer] ❌ Vite did not start cleanly. Consider running ./vm-recovery.sh"
  exit 1
fi

echo "[stabilizer] ✅ Environment appears stable."

# Instructions for restoring Playwright config after tests
echo "[stabilizer] ℹ️ Remember to restore Playwright config from $PLAYWRIGHT_CONFIG.bak after testing."

