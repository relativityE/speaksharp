#!/bin/bash
set -euo pipefail
export HUSKY=0

echo "--- Running Lint Check ---"
pnpm lint
