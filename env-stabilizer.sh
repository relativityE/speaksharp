#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}"   # default mode = dev

echo "🚀 Running env-stabilizer in $MODE mode..."

# ================= DEV, CI, DEPS MODES =================
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

  # Restore tracked files and clean caches
  git restore .
  rm -rf dist .cache .playwright node_modules/.vite

  # Install dependencies only if missing
  if [[ ! -d node_modules ]]; then
    echo "⬇️ Installing dependencies (node_modules missing)..."
    pnpm install
  else
    echo "📦 node_modules already present, skipping reinstall"
  fi

  # Quick Vite check (non-blocking)
  echo "🔎 Checking Vite startup..."
  pnpm run dev > vite-start.log 2>&1 &
  VITE_PID=$!
  sleep 1  # minimal buffer to let process start
  if nc -z localhost 5173; then
    echo "✅ Vite appears to be running on port 5173"
  else
    echo "⚠️ Vite did not respond on port 5173. Check vite-start.log if needed."
  fi
  kill $VITE_PID || true

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

# ================= PLAYWRIGHT PATCH =================
if [[ "${STABILIZE_PLAYWRIGHT:-0}" -eq 1 ]]; then
  echo "📝 Hardening playwright.config.ts..."
  cp playwright.config.ts playwright.config.ts.bak

  sed -i.bak 's/workers:.*/workers: 1,/' playwright.config.ts || true
  sed -i.bak 's/reuseExistingServer:.*/reuseExistingServer: false,/' playwright.config.ts || true
fi

echo "✅ Environment stabilization complete!"