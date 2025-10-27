
#!/bin/bash
set -euo pipefail

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
prepare_stage

echo "--- Running All Test Shards ---"
for i in $(seq 0 $((NUM_SHARDS - 1))); do
    test_stage "$i"
done

report_stage

echo "✅ Full test audit completed successfully."
