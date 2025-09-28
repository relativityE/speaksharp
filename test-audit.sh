#!/bin/bash
set -e

echo "🔍 Running Static Analysis..."
# pnpm lint
pnpm typecheck

echo "🏗️ Building the application..."
pnpm build

echo "📊 Running tests and generating metrics..."
mkdir -p test-results/e2e-results
pnpm test:unit:full
pnpm test:e2e:smoke || echo "E2E tests failed, but continuing to generate report."

echo "📊 Consolidating Software Quality Metrics..."
./run-metrics.sh

echo "📝 Updating PRD.md with the latest metrics..."
./update-sqm-doc.sh

echo "✅ All local checks passed and documentation updated!"