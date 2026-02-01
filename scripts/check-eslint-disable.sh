#!/bin/bash
set -euo pipefail

echo "🔍 Checking for banned 'eslint-disable' directives..."

# Exclude node_modules, .git, dist, and this script itself
# We also exclude external/vendor files if any (e.g. minified libs)
# Grep returns 0 if found (fail), 1 if not found (pass)

if grep -r "eslint-disable" . \
    --exclude-dir=node_modules \
    --exclude-dir=.git \
    --exclude-dir=dist \
    --exclude-dir=coverage \
    --exclude-dir=.gemini \
    --exclude-dir=backend \
    --exclude-dir=docs \
    --exclude="check-eslint-disable.sh" \
    --exclude="pnpm-lock.yaml" \
    --exclude="mockServiceWorker.js" \
    --exclude="test-audit.sh" \
    --exclude="*.md"; then
    
    echo "❌ Error: 'eslint-disable' directives found in the codebase."
    echo "   Please fix the underlying lint errors instead of suppressing them."
    exit 1
else
    echo "✅ No 'eslint-disable' directives found."
    exit 0
fi
