#!/usr/bin/env bash
# -------------------------------------------------------
# 🧪 Pre-flight Validation Script
# Ensures the environment is stable before running full E2E or CI pipelines.
# -------------------------------------------------------
set -euo pipefail

echo "🚀 Starting Pre-flight Environment Validation..."

# 1️⃣ Kill Orphaned Processes
echo "  - Cleaning up stale Node.js or Vite processes..."
pgrep -fa node | grep -v "pgrep" | xargs -r kill -9 || true
pgrep -fa vite | grep -v "pgrep" | xargs -r kill -9 || true
echo "    ✅ Clean environment ensured."

# 2️⃣ Setup Environment
export NODE_ENV=test
export DOTENV_CONFIG_PATH=.env.test

# 3️⃣ Install Dependencies
echo "  - Installing dependencies..."
echo "    🔄 Performing clean install to ensure no stale modules..."
rm -rf node_modules
pnpm store prune
pnpm install --frozen-lockfile
echo "    ✅ Dependencies ready."

# 4️⃣ Ensure Playwright Browsers Installed
echo "  - Checking Playwright browsers..."
pnpm exec playwright install --with-deps
echo "    ✅ Playwright browsers ready."

# 5️⃣ Build the App (optional for CI smoke)
echo "  - Building project..."
pnpm run build
echo "    ✅ Build successful."

# 6️⃣ Run Health-Check Test (fast, minimal)
echo "  - Running E2E health check..."
pnpm exec playwright test "tests/e2e/health-check.e2e.spec.ts" --project=chromium --reporter=line
echo "    ✅ Health check passed."

echo "✅ Pre-flight Validation Complete. Environment is healthy and ready!"
