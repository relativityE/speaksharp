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
E2E_RESULTS_DIR="./test-results/playwright"
SHARDS_DIR="./test-support/shards"
FINAL_MERGED_E2E_REPORT="$E2E_RESULTS_DIR/results.json"
NUM_SHARDS=4

mkdir -p "$LOG_DIR"
mkdir -p "$E2E_RESULTS_DIR"
rm -rf "$SHARDS_DIR"
mkdir -p "$SHARDS_DIR"

# ================================
# STAGE 1: Prepare
# ================================
prepare_stage() {
    echo "--- Running Pre-flight Validation ---"
    ./scripts/preflight.sh > "$LOG_DIR/preflight.log" 2>&1
    echo "✅ Pre-flight validation successful."

    echo "--- Running Lint and Type Checks ---"
    pnpm lint > "$LOG_DIR/lint.log" 2>&1
    pnpm typecheck > "$LOG_DIR/typecheck.log" 2>&1

    echo "--- Building the Application ---"
    pnpm build > "$LOG_DIR/build.log" 2>&1

    echo "--- Running Unit Tests with Coverage ---"
    pnpm test:unit:full 2>&1 | tee "$LOG_DIR/unit-tests.log"

    echo "--- Auto-sharding E2E Tests ---"
    # Use find for robust test discovery
    mapfile -t TEST_FILES < <(find tests/e2e -name '*.e2e.spec.ts' | sort)

    if [ ${#TEST_FILES[@]} -eq 0 ]; then
        echo "⚠️ No E2E test files found. Skipping sharding."
        # Create empty shard files to prevent downstream errors
        for i in $(seq 0 $((NUM_SHARDS - 1))); do
            touch "$SHARDS_DIR/shard-$i.txt"
        done
        return
    fi

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
run_e2e_stage() {
    SHARD_INDEX=$1
    echo "--- Running E2E Test Stage for Shard $SHARD_INDEX ---"

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
    ls -lR test-results/

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

    echo "--- Handling Software Quality Metrics ---"
    # Always generate the metrics file, but conditionally decide what to do with it.
    if [ -f "./run-metrics.sh" ]; then
        ./run-metrics.sh

        if [ -n "${CI:-}" ]; then
            echo "CI environment detected. Updating PRD.md..."
            node scripts/update-prd-metrics.mjs
            echo "✅ SQM metrics updated in docs/PRD.md"
        else
            echo "Local environment detected. Printing metrics to console..."
            node scripts/print-metrics.mjs
        fi
    else
        echo "⚠️ Metric generation scripts not found, skipping SQM update."
    fi
}

# ================================
# Main command dispatcher
# ================================
ACTION=${1:-all} # Default to 'all' if no argument is provided

case "$ACTION" in
  prepare)
    prepare_stage
    ;;
  run-e2e)
    # New e2e runner with support for --shard flag
    SHARD_INDEX=""
    ALL_SHARDS=false

    while [ $# -gt 0 ]; do
        case "$1" in
            --shard=*)
                SHARD_INDEX="${1#*=}"
                shift
                ;;
            --all)
                ALL_SHARDS=true
                shift
                ;;
            *)
                shift
                ;;
        esac
    done

    if [ "$ALL_SHARDS" = true ]; then
        echo "--- Running all E2E shards sequentially ---"
        for i in $(seq 0 $((NUM_SHARDS - 1))); do
            run_e2e_stage "$i"
        done
    elif [ -n "$SHARD_INDEX" ]; then
        run_e2e_stage "$SHARD_INDEX"
    else
        echo "ERROR: 'run-e2e' action requires either '--shard=<index>' or '--all'."
        exit 1
    fi
    ;;
  report)
    report_stage
    ;;
  lint)
    echo "--- Running Lint Only ---"
    pnpm lint > "$LOG_DIR/lint.log" 2>&1
    ;;
  typecheck)
    echo "--- Running Type Check Only ---"
    pnpm typecheck > "$LOG_DIR/typecheck.log" 2>&1
    ;;
  unit)
    echo "--- Running Unit Tests with Coverage ---"
    pnpm test:unit:full 2>&1 | tee "$LOG_DIR/unit-tests.log"
    ;;
  all)
    prepare_stage
    echo "--- Running All Test Shards ---"
    for i in $(seq 0 $((NUM_SHARDS - 1))); do
        run_e2e_stage "$i"
    done
    report_stage
    ;;
  *)
    echo "❌ Unknown command: $ACTION"
    echo "Usage: $0 {prepare|run-e2e --shard=<index>|report|lint|typecheck|unit|all}"
    exit 1
    ;;
esac

echo "✅ Command '$ACTION' completed successfully."
