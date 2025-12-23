#!/bin/bash
set -euo pipefail

# CI-safe: prevent husky hooks during install
export HUSKY=0

# Install dependencies if node_modules missing
if [ ! -d "node_modules" ]; then
  echo "[preinstall] Installing dependencies..."
  pnpm install
else
  echo "[preinstall] node_modules already exists, skipping install."
fi
