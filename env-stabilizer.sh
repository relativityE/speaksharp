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

echo "[stabilizer] Sanity check: vite dev startup..."
if ! timeout 60 pnpm run dev | tee vite-start.log | grep -q "ready in"; then
  echo "[stabilizer] Vite did not start cleanly. Recommend vm-recovery.sh"
  exit 1
fi

echo "[stabilizer] Environment looks stable."

