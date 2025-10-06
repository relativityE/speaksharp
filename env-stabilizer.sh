#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}"   # default mode = dev

echo "🚀 Running env-stabilizer in $MODE mode..."

if [[ "$MODE" == "ci" ]]; then
  echo "💣 CI mode: Full environment reset"

  echo "🔄 Resetting repo..."
  git reset --hard HEAD
  git clean -fdx

  echo "🧹 Removing node_modules and lockfile..."
  rm -rf node_modules pnpm-lock.yaml

  echo "⬇️ Installing dependencies..."
  pnpm install

elif [[ "$MODE" == "dev" ]]; then
  echo "🛠 Dev mode: Safe cleanup (non-destructive)"

  echo "🔄 Restoring tracked files..."
  git restore .

  echo "🧹 Cleaning caches..."
  rm -rf dist .cache .playwright node_modules/.vite

  if [[ ! -d node_modules ]]; then
    echo "⬇️ Installing dependencies (node_modules missing)..."
    pnpm install
  else
    echo "📦 node_modules already present, skipping reinstall"
  fi

elif [[ "$MODE" == "deps" ]]; then
  echo "⚡ Deps mode: Dependency-only reset (fast)"

  echo "🧹 Removing node_modules and lockfile..."
  rm -rf node_modules pnpm-lock.yaml

  echo "⬇️ Installing dependencies..."
  pnpm install

  echo "✅ Dependencies refreshed (no Vite/Playwright checks run)"

else
  echo "❌ Unknown mode: $MODE"
  echo "Usage: ./env-stabilizer.sh [dev|ci|deps]"
  exit 1
fi

# Playwright config patching (only if requested)
if [[ "${STABILIZE_PLAYWRIGHT:-0}" -eq 1 ]]; then
  echo "📝 Hardening playwright.config.ts..."
  cp playwright.config.ts playwright.config.ts.bak

  sed -i.bak 's/workers:.*/workers: 1,/' playwright.config.ts || true
  sed -i.bak 's/reuseExistingServer:.*/reuseExistingServer: false,/' playwright.config.ts || true
fi

# Skip checks in deps mode
if [[ "$MODE" != "deps" ]]; then
  echo "🔎 Checking Vite startup..."
  # Kill any lingering Vite processes first to avoid port conflicts.
  pkill -f vite || true
  # Start Vite in the background and log its output.
  pnpm run dev > vite-start.log 2>&1 &
  VITE_PID=$!

  # Wait for a few seconds and check if Vite started successfully.
  if ! timeout 30s grep -q "ready in" <(tail -f vite-start.log); then
      echo "❌ Vite failed to start within 30 seconds. See vite-start.log"
      # Ensure the background process is killed before exiting.
      kill $VITE_PID || true
      exit 1
  fi

  echo "✅ Vite started successfully."
  # Kill the Vite process now that we've confirmed it works.
  kill $VITE_PID || true
fi

echo "✅ Environment stabilization complete!"