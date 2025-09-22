#!/bin/bash
set -euo pipefail
export HUSKY=0

echo "--- Running Lint Check ---"
if pnpm lint:fix; then
    echo "Lint check passed."
    exit 0
else
    echo "Lint check failed."
    exit 1
fi
