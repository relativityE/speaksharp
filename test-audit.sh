#!/bin/bash
set -euo pipefail

# ================================
# Paths and configuration
# ================================
LOG_DIR="./test-support/logs"
E2E_RESULTS_DIR="./test-results/e2e-results"
mkdir -p "$LOG_DIR/e2e"
mkdir -p "$E2E_RESULTS_DIR"
mkdir -p "./test-support/originals/docs-backup"

TASK_TIMEOUT=600
# Define a static number of shards. This is simpler and more robust than dynamic timing.
NUM_SHARDS=4 # Increased to 4 for better balance and to avoid timeouts

SHARDS_DIR="./test-support/shards"
E2E_SUMMARY_REPORT="./test-support/e2e-summary-report.md"
FINAL_MERGED_E2E_REPORT="$E2E_RESULTS_DIR/results.json"

# ================================
# Helper: run command with timeout & logs
# ================================
run_with_timeout() {
    local CMD="$1"
    local LOG_FILE="$2"
    echo "🔹 Running: $CMD"
    if ! timeout "$TASK_TIMEOUT"s bash -c "$CMD" >"$LOG_FILE" 2>&1; then
        echo "❌ Command failed or timed out: $CMD. See log at $LOG_FILE" >&2
        exit 1
    fi
    echo "✅ Command successful: $CMD"
}

# ================================
# STAGE 1: Prepare
# ================================
prepare_stage() {
    echo "--- Running Pre-flight Validation ---"
    if ! ./scripts/preflight.sh > "$LOG_DIR/preflight.log" 2>&1; then
        echo "❌ Pre-flight validation failed. See log at $LOG_DIR/preflight.log" >&2
        exit 1
    fi
    echo "✅ Pre-flight validation successful."

    echo "--- Running Prepare Stage ---"
    run_with_timeout "pnpm lint" "$LOG_DIR/lint.log"
    run_with_timeout "pnpm typecheck" "$LOG_DIR/typecheck.log"
    run_with_timeout "pnpm build" "$LOG_DIR/build.log"
    run_with_timeout "pnpm test:unit:full" "$LOG_DIR/unit-tests.log"

    echo "--- Auto-sharding E2E Tests using round-robin distribution ---"
    rm -rf "$SHARDS_DIR"
    mkdir -p "$SHARDS_DIR"

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

    echo "✅ E2E tests sharded into $NUM_SHARDS files in $SHARDS_DIR"
}

# ================================
# STAGE 2: Test
# ================================
test_stage() {
    SHARD_INDEX=$1
    echo "--- Running Test Stage for Shard $SHARD_INDEX ---"

    SHARD_FILE="$SHARDS_DIR/shard-$SHARD_INDEX.txt"

    if [ ! -s "$SHARD_FILE" ]; then
        echo "⚠️ No tests for shard $SHARD_INDEX. Skipping."
        return 0
    fi

    # Read test files from the shard file
    SHARD_TESTS=$(cat "$SHARD_FILE")

    echo "⏱ Running tests for shard $SHARD_INDEX"
    if ! pnpm exec playwright test $SHARD_TESTS --workers=1 --reporter=json --output="$E2E_RESULTS_DIR/shard-${SHARD_INDEX}-report.json"; then
        echo "❌ Test shard $SHARD_INDEX failed."
        return 1
    fi
    return 0
}

# ================================
# STAGE 3: Report
# ================================
report_stage() {
    echo "--- Running Report Stage ---"

    echo "--- Merging E2E Test Reports ---"
    pnpm exec playwright merge-reports --reporter json --output "$FINAL_MERGED_E2E_REPORT" "$E2E_RESULTS_DIR"/shard-*-report.json || echo "⚠️ Could not merge E2E reports."

    echo "--- Generating Human-Readable Summary Report ---"
    {
        echo "# E2E Test Summary Report"
        echo ""
        echo "| Test File | Status | Duration (s) |"
        echo "|-----------|--------|--------------|"
    } > "$E2E_SUMMARY_REPORT"

    if [ -f "$FINAL_MERGED_E2E_REPORT" ]; then
      jq -r '.suites[].suites[].specs[] | "\(.file) | \(.status) | \(.tests[0].results[0].duration / 1000)"' "$FINAL_MERGED_E2E_REPORT" | \
      sed 's/passed/✅ Passed/; s/failed/❌ Failed/; s/timedOut/❌ Timed Out/' | \
      awk -F '|' '{printf "| `%-45s` | %-12s | %-12s |\n", $1, $2, $3}' >> "$E2E_SUMMARY_REPORT"
    fi

    echo "✅ E2E Summary Report generated at $E2E_SUMMARY_REPORT"

    echo "--- Updating SQM Data in PRD.md ---"
    if [ -f "./run-metrics.sh" ] && [ -f "./update-sqm-doc.sh" ]; then
        ./run-metrics.sh
        ./update-sqm-doc.sh
        echo "✅ SQM metrics updated in docs/PRD.md"
    else
        echo "⚠️ Metric generation scripts not found, skipping SQM update."
    fi
}

# ================================
# Main command dispatcher
# ================================
COMMAND=${1:-"all"}
SHARD_INDEX=${2:-}

case "$COMMAND" in
    prepare) prepare_stage ;;
    test) test_stage "$SHARD_INDEX" ;;
    report) report_stage ;;
    all)
        prepare_stage
        echo "--- Running All Test Shards ---"
        FAIL=0
        for i in $(seq 0 $((NUM_SHARDS - 1))); do
            test_stage "$i" || FAIL=1
        done
        report_stage
        if [ "$FAIL" -eq 1 ]; then
            echo "❌ One or more test shards failed." >&2; exit 1
        fi
        ;;
    *) echo "❌ ERROR: Unknown command '$COMMAND'." >&2; exit 1 ;;
esac
