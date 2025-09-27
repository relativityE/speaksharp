#!/bin/bash
set -e

echo "🔍 Fast Feedback (< 2 mins)"
pnpm lint && pnpm typecheck

echo "📊 Running tests and generating metrics..."
mkdir -p test-results
pnpm test:unit:full

echo "📊 Generating Software Quality Metrics..."
# This script combines individual metric files into one
./run-metrics.sh

echo "📝 Updating PRD.md with the latest metrics..."
# This script takes the generated metrics and updates the PRD
./update-sqm-doc.sh

echo "✅ All local checks passed and documentation updated!"