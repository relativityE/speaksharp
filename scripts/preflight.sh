#!/bin/bash
# Pre-flight Validation Script
# This script MUST be run at the start of every session to ensure a stable environment.
# It performs the following actions:
#   1. Terminates any orphaned Node.js or Vite processes.
#   2. Installs all pnpm dependencies.
#   3. Installs all required Playwright browser binaries.
#   4. Runs a minimal E2E smoke test to verify application and test runner stability.
set -e

echo "🚀 Starting Pre-flight Environment Validation..."

# 1. Terminate Orphaned Processes
echo "  - Checking for and terminating orphaned Node.js or Vite processes..."
pgrep -fa node | xargs -r kill -9 || true
pgrep -fa vite | xargs -r kill -9 || true
echo "    ✅ Orphaned processes terminated."

# 2. Install Dependencies
echo "  - Installing pnpm dependencies..."
pnpm install
echo "    ✅ Dependencies installed."

# 3. Install Playwright Browsers
echo "  - Installing Playwright browser binaries..."
pnpm exec playwright install --with-deps
echo "    ✅ Playwright browsers installed."

# 4. Run E2E Smoke Test
echo "  - Running E2E smoke test to verify environment stability..."
pnpm test:e2e:smoke --grep "should log in"
echo "    ✅ E2E smoke test passed."

echo "✅ Pre-flight Environment Validation Complete. The environment is stable and ready."
