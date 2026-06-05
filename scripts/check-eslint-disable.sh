#!/bin/bash
set -euo pipefail

echo "🔍 Checking for banned 'eslint-disable' directives..."

# Exclude node_modules, .git, dist, and this script itself.
# We also exclude external/vendor files if any (e.g. minified libs).
# Data/evidence files (JSON) and the release docs/evidence tree are excluded too: they can
# legitimately contain the literal string "eslint-disable" (e.g. a test-evidence JSON that
# describes THIS very gate), which is not a real lint-suppression directive and must not trip the
# scan. eslint-disable directives only ever live in JS/TS source comments. (RC-LH-1 false positive.)
# Grep returns 0 if found (fail), 1 if not found (pass)

if grep -r "eslint-disable" . \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=dist \
    --exclude-dir=dist-e2e \
    --exclude-dir=coverage \
    --exclude-dir=frontend/coverage \
    --exclude-dir=.gemini \
    --exclude-dir=backend \
    --exclude-dir=docs \
    --exclude-dir=brain \
    --exclude-dir=.agent \
    --exclude-dir=product_release \
    --exclude-dir=test-results \
    --exclude="check-eslint-disable.sh" \
    --exclude="package.json" \
    --exclude="pnpm-lock.yaml" \
    --exclude="mockServiceWorker.js" \
    --exclude="test-audit.sh" \
    --exclude="*.md" \
    --exclude="*.json" \
    --exclude="*.log" \
    --exclude="run-ci.mjs"; then
    
    echo "❌ Error: 'eslint-disable' directives found in the codebase."
    echo "   Please fix the underlying lint errors instead of suppressing them."
    exit 1
else
    echo "✅ No 'eslint-disable' directives found."
    exit 0
fi
