#!/bin/bash
set -e

echo "🔍 Fast Feedback (< 2 mins)"
pnpm lint:fix && pnpm typecheck && pnpm test:unit:core

echo "✅ All local checks passed!"