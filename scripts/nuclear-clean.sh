#!/bin/bash
# File: scripts/nuclear-clean.sh

echo "🧹 Nuclear clean - killing ALL caches..."

# 1. Kill any running processes
echo "Killing vite/playwright processes..."
pkill -f vite
pkill -f playwright
sleep 2

# 2. Clear Vite caches
echo "Clearing Vite caches..."
rm -rf frontend/dist
rm -rf frontend/node_modules/.vite
rm -rf frontend/.vite

# 3. Clear Playwright caches
echo "Clearing Playwright caches..."
# rm -rf ~/.cache/ms-playwright # Skipping global cache wipe to avoid huge download penalty for now, unless necessary
# rm -rf ~/Library/Caches/ms-playwright  # macOS
# npx playwright install --force  # Reinstall fresh browsers

# 4. Clear Node module cache
echo "Clearing Node module cache..."
rm -rf node_modules/.cache

# 5. Clear test artifacts
echo "Clearing test artifacts..."
rm -rf test-results
rm -rf playwright-report
rm -rf .playwright

# 6. Verify dist is truly empty
if [ -d "frontend/dist" ]; then
  echo "❌ ERROR: dist still exists!"
  exit 1
fi

echo "✅ Nuclear clean complete"
