#!/bin/bash
set -euo pipefail
export HUSKY=0

TEST_RESULTS_DIR="test-results"

echo "--- Running Production Build ---"

mkdir -p "$TEST_RESULTS_DIR"

if pnpm build > "$TEST_RESULTS_DIR/build.log" 2>&1; then
    echo "Build successful."
    size=$(du -sh dist | cut -f1)
    jq -n --arg size "$size" '{bundle:{size:$size}}' > "$TEST_RESULTS_DIR/bundle-metrics.json"
    echo "Bundle analysis complete. Size: $size"
    exit 0
else
    echo "Build failed. See build.log for details."
    jq -n '{bundle:{size:"unknown"}}' > "$TEST_RESULTS_DIR/bundle-metrics.json"
    exit 1
fi
