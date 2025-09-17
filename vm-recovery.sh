#!/bin/bash
# vm-recovery.sh - Safe VM recovery for sandboxed environments

echo "🔄 Starting VM recovery process..."

# Kill leftover Vite/Node processes
pkill -f vite
pkill -f node
pkill -f playwright

# Clear old test reports
echo "🧹 Cleaning old test reports..."
rm -rf playwright-report/ test-results/ debug-*.png debug-*.html

# Ensure node_modules exists
if [ ! -d "node_modules" ]; then
    echo "⚠️ node_modules missing, running pnpm install..."
    pnpm install
fi

echo "✅ VM recovery complete."
