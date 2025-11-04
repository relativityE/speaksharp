#!/bin/bash
set -euo pipefail

# New User Experience Improvement: Check for dependencies first.
if [ ! -d "node_modules" ]; then
    echo "🤔 node_modules not found. Running pnpm install..."
    pnpm install
    echo "✅ Dependencies installed."
fi

# ================================
# Paths and configuration
# ================================
LOG_DIR="./test-support/logs"
E2E_RESULTS_DIR="tests/test-results/playwright"
SHARDS_DIR="./test-support/shards"
FINAL_MERGED_E2E_REPORT="$E2E_RESULTS_DIR/results.json"
NUM_SHARDS=4

mkdir -p "$LOG_DIR"
mkdir -p "$E2E_RESULTS_DIR"
rm -rf "$SHARDS_DIR"
mkdir -p "$SHARDS_DIR"

# ================================
# LOCAL-ONLY FAST MODE
# ================================
local_fast() {
    echo "🚀 Running FAST local validation..."

    # Quick preflight only
    export FAST_MODE=true
    ./scripts/preflight.sh || exit 1

    # Lint only changed files (if git available)
    if command -v git &> /dev/null; then
        CHANGED_FILES=$(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || true)
        if [ -n "$CHANGED_FILES" ]; then
            echo "Linting changed files only..."
            pnpm eslint $CHANGED_FILES --max-warnings 0
        fi
    else
        echo "⚠️ Git not available, running full lint..."
        pnpm lint
    fi

    # Skip typecheck (too slow for quick iteration)
    echo "⏩ Skipping typecheck in fast mode (run 'all' before commit)"

    # Skip build (dev server is enough)
    echo "⏩ Skipping production build"

    # Unit tests WITHOUT coverage (much faster)
    pnpm vitest run || exit 1

    # E2E health check only (skip full suite)
    pnpm test:e2e:health || exit 1

    echo "✅ Fast local validation complete!"
    echo "💡 Run './test-audit.sh all' before pushing to ensure full CI compliance"
}

# ================================
# OPTIMIZED LOCAL MODE
# ================================
local_full() {
    echo "🔍 Running FULL local validation (optimized)..."

    ./scripts/preflight.sh || exit 1

    # Parallel execution where possible
    echo "Running lint and unit tests in parallel..."
    pnpm lint > "$LOG_DIR/lint.log" 2>&1 &
    LINT_PID=$!

    pnpm vitest run --coverage > "$LOG_DIR/unit-tests.log" 2>&1 &
    UNIT_PID=$!

    # Wait for parallel jobs
    wait $LINT_PID || { echo "❌ Lint failed"; exit 1; }
    wait $UNIT_PID || { echo "❌ Unit tests failed"; exit 1; }

    # Typecheck (can't parallelize effectively)
    pnpm typecheck > "$LOG_DIR/typecheck.log" 2>&1 || exit 1

    # Skip production build locally
    echo "⏩ Skipping production build (CI will validate)"

    # Run E2E tests (no sharding needed for 6 tests)
    pnpm test:e2e || exit 1

    echo "✅ Full local validation complete!"
}

# ================================
# STAGE 1: Prepare
# ================================
prepare_stage() {
    echo "--- Running Pre-flight Validation ---"
    ./scripts/preflight.sh > "$LOG_DIR/preflight.log" 2>&1

    # OPTIMIZATION: Run lint and typecheck in parallel
    echo "--- Running Lint and Type Checks (parallel) ---"
    pnpm lint > "$LOG_DIR/lint.log" 2>&1 &
    LINT_PID=$!

    pnpm typecheck > "$LOG_DIR/typecheck.log" 2>&1 &
    TYPE_PID=$!

    # OPTIMIZATION: Start unit tests while lint/type check run
    echo "--- Running Unit Tests with Coverage (parallel) ---"
    pnpm test:unit:full 2>&1 | tee "$LOG_DIR/unit-tests.log" &
    UNIT_PID=$!

    # Wait for all parallel jobs
    wait $LINT_PID || { echo "❌ Lint failed"; exit 1; }
    wait $TYPE_PID || { echo "❌ Type check failed"; exit 1; }
    wait $UNIT_PID || { echo "❌ Unit tests failed"; exit 1; }

    # Build can't be parallelized, but maybe skip in local mode?
    echo "--- Building the Application ---"
    pnpm build > "$LOG_DIR/build.log" 2>&1

    # Sharding setup
    echo "--- Auto-sharding E2E Tests ---"
    TEST_FILES=(tests/e2e/*.e2e.spec.ts)
    for i in $(seq 0 $((NUM_SHARDS - 1))); do
        echo "" > "$SHARDS_DIR/shard-$i.txt"
    done
    INDEX=0
    for TEST_FILE in "${TEST_FILES[@]}"; do
        SHARD_INDEX=$((INDEX % NUM_SHARDS))
        echo "$TEST_FILE" >> "$SHARDS_DIR/shard-$SHARD_INDEX.txt"
        INDEX=$((INDEX + 1))
    done
    echo "✅ E2E tests sharded into $NUM_SHARDS files."
}

# ================================
# STAGE 2: E2E Test
# ================================
test_stage() {
    SHARD_INDEX=$1
    echo "--- Running Test Stage for Shard $SHARD_INDEX ---"

    SHARD_FILE="$SHARDS_DIR/shard-$SHARD_INDEX.txt"
    if [ ! -s "$SHARD_FILE" ]; then
        echo "⚠️ No tests for shard $SHARD_INDEX. Skipping."
        return 0
    fi

    SHARD_TESTS=$(cat "$SHARD_FILE")
    # ARCHITECTURAL FIX: Each shard gets its own isolated output directory
    SHARD_OUTPUT_DIR="$E2E_RESULTS_DIR/shard-${SHARD_INDEX}-results"
    REPORT_FILE="$SHARD_OUTPUT_DIR/report.json"
    mkdir -p "$SHARD_OUTPUT_DIR"

    echo "⏱ Running tests for shard $SHARD_INDEX"
    PLAYWRIGHT_JSON_OUTPUT_NAME="$REPORT_FILE" \
        pnpm exec playwright test $SHARD_TESTS \
        --output="$SHARD_OUTPUT_DIR" \
        --reporter=json \
        || {
            echo "❌ Test shard $SHARD_INDEX failed."
            # Continue to report stage even if a shard fails
        }

    if [ ! -f "$REPORT_FILE" ]; then
        echo "⚠️ WARNING: Report file not created for shard $SHARD_INDEX at $REPORT_FILE"
    fi
}

# ================================
# STAGE 3: Report
# ================================
report_stage() {
    echo "--- Running Report Stage ---"
    echo "--- DIAGNOSTIC: Final state of test-results ---"
    ls -lR tests/test-results/

    echo "--- Merging E2E Test Reports ---"
    REPORTS_TO_MERGE=()
    for i in $(seq 0 $((NUM_SHARDS - 1))); do
        REPORT_FILE="$E2E_RESULTS_DIR/shard-${i}-results/report.json"
        if [ -f "$REPORT_FILE" ]; then
            REPORTS_TO_MERGE+=("$REPORT_FILE")
        fi
    done

    if [ ${#REPORTS_TO_MERGE[@]} -eq 0 ]; then
        echo "❌ No valid shard reports found to merge."
        exit 1
    fi

    echo "Found ${#REPORTS_TO_MERGE[@]} reports to merge."
    node scripts/merge-reports.mjs "$FINAL_MERGED_E2E_REPORT" "${REPORTS_TO_MERGE[@]}"

    echo "--- Updating SQM Data in PRD.md ---"
    if [ -f "./run-metrics.sh" ] && [ -f "./scripts/update-prd-metrics.mjs" ]; then
        ./run-metrics.sh
        node scripts/update-prd-metrics.mjs
        echo "✅ SQM metrics updated in docs/PRD.md"
    else
        echo "⚠️ Metric generation scripts not found, skipping SQM update."
    fi
}

# ================================
# Main command dispatcher
# ================================
# New mode: Only run what changed
incremental() {
    if ! command -v git &> /dev/null; then
        echo "❌ Git required for incremental mode"
        exit 1
    fi

    CHANGED_FILES=$(git diff --name-only --diff-filter=ACMR HEAD)

    # Detect what needs to run
    HAS_TS_CHANGES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' || true)
    HAS_TEST_CHANGES=$(echo "$CHANGED_FILES" | grep -E '\.test\.(ts|tsx)$' || true)
    HAS_E2E_CHANGES=$(echo "$CHANGED_FILES" | grep -E 'e2e.*\.spec\.ts$' || true)

    if [ -n "$HAS_TS_CHANGES" ]; then
        echo "Running lint on changed files..."
        pnpm eslint $HAS_TS_CHANGES --max-warnings 0

        echo "Running typecheck..."
        pnpm typecheck
    fi

    if [ -n "$HAS_TEST_CHANGES" ]; then
        echo "Running related unit tests..."
        pnpm vitest run $HAS_TEST_CHANGES
    fi

    if [ -n "$HAS_E2E_CHANGES" ]; then
        echo "Running changed E2E tests..."
        pnpm playwright test $HAS_E2E_CHANGES
    fi
}
case "${1:-all}" in
    fast)
        local_fast
        ;;
    local)
        local_full
        ;;
    all)
        # Original full CI-compatible flow
        prepare_stage
        for i in $(seq 0 $((NUM_SHARDS - 1))); do
            test_stage "$i"
        done
        report_stage
        echo "✅ Full CI-compatible test audit completed."
        ;;
    incremental)
        incremental
        ;;
    prepare)
        prepare_stage
        ;;
    test)
        test_stage "${2}"
        ;;
    report)
        report_stage
        ;;
    *)
        echo "Usage: $0 {fast|local|all|incremental|prepare|test|report}"
        echo "  fast  - Quick validation for rapid iteration (2-3 min)"
        echo "  local - Full local check before commit (4-5 min)"
        echo "  all   - Complete CI-compatible audit (6-7 min)"
        echo "  incremental - Run checks only on changed files"
        echo "  --- CI Commands ---"
        echo "  prepare - Runs setup, lint, build, unit tests, and sharding"
        echo "  test <shard-index> - Runs a specific E2E test shard"
        echo "  report - Merges reports and updates documentation"
        exit 1
        ;;
esac
