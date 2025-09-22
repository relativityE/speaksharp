#!/bin/bash
set -euo pipefail
export HUSKY=0

echo "--- Running Type Check ---"
if pnpm type-check; then
    echo "Type check passed."
    exit 0
else
    echo "Type check failed."
    exit 1
fi
