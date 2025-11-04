#!/bin/bash
set -euo pipefail

# Cleanup temporary files and stale state
echo "[vm-recovery] Cleaning environment..."
rm -rf node_modules tests/test-results coverage dist
git reset --hard HEAD >/dev/null 2>&1
git clean -fdx >/dev/null 2>&1

echo "[vm-recovery] Environment reset complete."
