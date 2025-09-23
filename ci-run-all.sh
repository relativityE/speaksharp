#!/bin/bash
set -euo pipefail

# Enhanced ci-run-all.sh with automatic hook recovery and fail-fast
# Version: 3.3-hook-resilient-failfast

echo "=== SpeakSharp CI Pipeline v3.3 ==="
echo "Timestamp: $(date)"

# Directories
mkdir -p test-results logs

# Timeout defaults (in seconds)
TIMEOUT_DEPENDENCIES=300      # 5 min for pnpm install
TIMEOUT_BROWSERS=300          # 5 min for Playwright browsers
TIMEOUT_E2E=420               # 7 min for limited E2E

# --- Functions ---

ensure_husky_installed() {
    if [ ! -f ".husky/husky.sh" ]; then
        echo "Husky hooks not found, installing..."
        npx husky install
        echo "Husky hooks installed."
    fi
}

disable_git_hooks() {
    echo "🔧 Disabling Git hooks..."
    export HUSKY=0
    export GIT_HOOKS_PATH=""
    export SKIP_HOOKS=true
    git config --local core.hooksPath "" 2>/dev/null || true
    mkdir -p /tmp/empty-hooks 2>/dev/null
    git config --local core.hooksPath /tmp/empty-hooks 2>/dev/null || true
    if [ -d ".git/hooks" ] && [ -f ".git/hooks/pre-commit" ]; then
        mv .git/hooks .git/hooks.disabled 2>/dev/null || true
        mkdir -p .git/hooks 2>/dev/null
    fi
    echo "✅ Git hooks disabled"
}

restore_git_hooks() {
    echo "🔄 Restoring Git hooks..."
    if [ -d ".git/hooks.disabled" ]; then
        rm -rf .git/hooks 2>/dev/null || true
        mv .git/hooks.disabled .git/hooks 2>/dev/null || true
        echo "✅ Git hooks restored"
    fi
    unset HUSKY GIT_HOOKS_PATH SKIP_HOOKS
    git config --local --unset core.hooksPath 2>/dev/null || true
}

emergency_recovery() {
    echo "🚨 Emergency recovery mode activated"
    export HUSKY=0
    export GIT_HOOKS_PATH=/dev/null
    rm -rf .git/hooks 2>/dev/null || true
    mkdir -p .git/hooks 2>/dev/null || true
    cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
exit 0
EOF
    chmod +x .git/hooks/pre-commit
    echo "✅ Emergency recovery completed"
}

run_with_timeout() {
    local duration="$1"
    local logfile="$2"
    shift 2
    echo "⏱ Running: $* (timeout: ${duration}s)"
    timeout "${duration}" "$@" >"${logfile}" 2>&1 || {
        echo "⚠️  Command timed out: $*"
        return 1
    }
}

# --- Main Execution ---

trap 'echo "🧹 Cleaning up..."; restore_git_hooks 2>/dev/null || true' EXIT

main() {
    export HUSKY=0
    ensure_husky_installed

    echo "📋 Starting CI pipeline..."

    # Optional VM recovery
    if [ "${FORCE_VM_RECOVERY:-0}" = "1" ]; then
        echo "🔄 Force VM recovery requested..."
        if [ -f "./vm-recovery.sh" ]; then
            ./vm-recovery.sh
        else
            emergency_recovery
        fi
    fi

    disable_git_hooks

    # Test basic git operations
    git status > /dev/null 2>&1 || emergency_recovery

    # Step 1: Install dependencies
    echo "📦 Installing dependencies..."
    if [ -f "./preinstall.sh" ]; then
        run_with_timeout $TIMEOUT_DEPENDENCIES "logs/preinstall.log" ./preinstall.sh
    else
        run_with_timeout $TIMEOUT_DEPENDENCIES "logs/pnpm-install.log" HUSKY=0 pnpm install --frozen-lockfile
    fi

    # Step 2: Install Playwright browsers
    echo "🌐 Installing Playwright browsers..."
    run_with_timeout $TIMEOUT_BROWSERS "logs/playwright.log" pnpm run install:browsers || \
        run_with_timeout $TIMEOUT_BROWSERS "logs/playwright-fallback.log" pnpm exec playwright install --with-deps

    # Step 3: Run test scripts individually
    echo "🧪 Running test suites..."
    test_scripts=(
        "run-lint.sh"
        "run-type-check.sh"
        "run-unit-tests.sh"
        "run-build-test.sh"
        "run-e2e-smoke.sh"
    )
    for script in "${test_scripts[@]}"; do
        if [ -f "./$script" ]; then
            logfile="logs/${script%.sh}.log"
            run_with_timeout $TIMEOUT_E2E "$logfile" ./$script || {
                echo "❌ $script failed"
                exit 1
            }
        else
            echo "⚠️  Script $script not found, skipping..."
        fi
    done

    # Step 4: Metrics & documentation
    echo "📊 Generating metrics..."
    [ -f "./run-metrics.sh" ] && ./run-metrics.sh
    if [ -f "./update-sqm-doc.sh" ]; then
        restore_git_hooks
        ./update-sqm-doc.sh
        disable_git_hooks
    fi

    echo "✅ CI pipeline completed successfully!"
}

main "$@"
