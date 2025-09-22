#!/bin/bash
# vm-recovery.sh - Safe VM recovery and cleanup

set -euxo pipefail

echo "🔄 Starting VM recovery..."

# Step 1: Kill lingering processes
echo "📋 Checking running processes..."
pids=$(ps aux | grep -E "(vite|node|playwright)" | grep -v grep | awk '{print $2}' || true)

if [ -n "$pids" ]; then
    echo "🔌 Stopping processes: $pids"
    for pid in $pids; do
        timeout 5 kill $pid 2>/dev/null || echo "PID $pid already gone"
    done
    sleep 2
else
    echo "✅ No processes to stop"
fi

# Step 2: Free port 5173
echo "🔍 Checking port 5173..."
if lsof -i :5173 >/dev/null 2>&1; then
    echo "⚠️ Port 5173 occupied, killing..."
    fuser -k 5173/tcp || true
else
    echo "✅ Port 5173 is free"
fi

# Step 3: Handle detached HEAD
current_branch=$(git branch --show-current || true)
if [ -z "$current_branch" ]; then
    echo "⚠️ Detached HEAD detected. Creating temporary branch..."
    tmp_branch="e2e-temp-branch"
    git branch -D "$tmp_branch" 2>/dev/null || true
    git checkout -b "$tmp_branch"
else
    echo "✅ On branch '$current_branch'"
fi

# Step 4: Optional quick validation test (timeout-protected)
echo "🧪 Running quick validation test..."
timeout 60 pnpm run test:e2e -- --grep "should be able to start a temporary session" --timeout 10000 || {
    echo "⚠️ Quick validation test failed. Dumping JSON..."
    if [ -f test-results/e2e-results/results.json ]; then
        cat test-results/e2e-results/results.json
    fi
}

echo "✅ VM recovery completed"
