#!/bin/bash
set -euo pipefail

echo "[stabilizer] Killing zombie processes..."
pkill -f 'node|vite|playwright' || true

echo "[stabilizer] Clearing caches..."
rm -rf node_modules/.vite .cache .playwright

echo "[stabilizer] Verifying no ports in use..."
lsof -i :3000 -i :5173 -i :9323 || true

echo "[stabilizer] Sanity check: shell works..."
echo "sanity-ok" | tee sanity.log

# Guard clause: detect missing build artifacts
MISSING_ARTIFACTS=false
if [ ! -d "node_modules" ]; then
  echo "[stabilizer] node_modules missing!"
  MISSING_ARTIFACTS=true
fi

if [ ! -d "dist" ] && [ ! -d "build" ]; then
  echo "[stabilizer] Build artifacts missing!"
  MISSING_ARTIFACTS=true
fi

if [ "$MISSING_ARTIFACTS" = true ]; then
  echo "[stabilizer] Environment incomplete. Recommended fix:"
  echo "1. Run 'pnpm install' to ensure dependencies are installed."
  echo "2. Run 'pnpm setup:dev' to build dev artifacts."
  exit 1
fi

echo "[stabilizer] Sanity check: vite dev startup..."
if ! timeout 60 pnpm run dev | tee vite-start.log | grep -q "ready in"; then
  echo "[stabilizer] Vite did not start cleanly. Recommend vm-recovery.sh"
  exit 1
fi

echo "[stabilizer] Environment looks stable."

