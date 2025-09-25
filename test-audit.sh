#!/bin/bash
set -e

echo "🔍 Fast Feedback (< 2 mins)"
pnpm lint || true && pnpm type-check && pnpm test:unit:core

echo "🧪 Comprehensive Testing (parallel)"
pnpm test:unit:full &
pnpm test:e2e:shard &
wait

echo "📸 Visual Regression (if needed)"
if [[ "$VISUAL_TESTS" == "true" ]]; then
  pnpm test:screenshots
fi