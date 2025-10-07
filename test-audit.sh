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
E2E_TEST_TIMEOUT=240
MAX_SHARD_TIME=420

RUNTIME_FILE="./test-support/e2e-test-runtimes.json"
SHARDS_FILE="./test-support/e2e-shards.json"
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
    echo "--- Running Prepare Stage ---"
    echo "🔹 Installing Playwright browsers..."
    pnpm exec playwright install --with-deps > "$LOG_DIR/playwright-install.log" 2>&1

    run_with_timeout "pnpm lint" "$LOG_DIR/lint.log"
    run_with_timeout "pnpm typecheck" "$LOG_DIR/typecheck.log"
    run_with_timeout "pnpm build" "$LOG_DIR/build.log"
    run_with_timeout "pnpm test:unit:full" "$LOG_DIR/unit-tests.log"

    echo "--- Timing E2E Tests ---"
    TEST_FILES=(tests/e2e/*.e2e.spec.ts)
    echo "{}" > "$RUNTIME_FILE"

    for TEST_FILE in "${TEST_FILES[@]}"; do
        START=$(date +%s)
        # Run in a subshell to prevent script exit on test failure
        (timeout "$E2E_TEST_TIMEOUT"s pnpm exec playwright test "$TEST_FILE" --workers=1 --reporter=list > /dev/null 2>&1) || true
        END=$(date +%s)
        DURATION=$((END-START))
        TMP_JSON=$(mktemp)
        jq --arg test "$TEST_FILE" --argjson dur "$DURATION" '. + {($test): $dur}' "$RUNTIME_FILE" > "$TMP_JSON" && mv "$TMP_JSON" "$RUNTIME_FILE"
    done

    echo "--- Auto-sharding E2E Tests ---"
    python3 -c "
import json
with open('$RUNTIME_FILE', 'r') as f: runtimes = json.load(f)
shards, current_shard, current_sum = [], [], 0
for test, duration in sorted(runtimes.items(), key=lambda x: x[1], reverse=True):
    if current_sum + duration > $MAX_SHARD_TIME and current_shard:
        shards.append(current_shard)
        current_shard, current_sum = [], 0
    current_shard.append(test)
    current_sum += duration
if current_shard: shards.append(current_shard)
with open('$SHARDS_FILE', 'w') as f: json.dump({'shards': shards, 'shard_count': len(shards)}, f, indent=2)
print(f'Shards written to $SHARDS_FILE')
"
}

# ================================
# STAGE 2: Test
# ================================
test_stage() {
    SHARD_INDEX=$1
    echo "--- Running Test Stage for Shard $SHARD_INDEX ---"

    SHARD_TESTS=$(jq -r ".shards[$SHARD_INDEX][]" "$SHARDS_FILE")
    if [ -z "$SHARD_TESTS" ]; then
        echo "⚠️ No tests found for shard $SHARD_INDEX. Skipping."
        return 0
    fi

    echo "⏱ Running tests for shard $SHARD_INDEX"
    # CRITICAL FIX: Add --workers=1 to force serial execution and prevent resource contention.
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
    # This command can fail if no tests were run (e.g., all shards were empty)
    pnpm exec playwright merge-reports --reporter json --output "$FINAL_MERGED_E2E_REPORT" "$E2E_RESULTS_DIR"/shard-*-report.json || echo "⚠️ Could not merge E2E reports. This may happen if no tests were run."

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
    prepare)
        prepare_stage
        ;;
    test)
        test_stage "$SHARD_INDEX"
        ;;
    report)
        report_stage
        ;;
    all)
        prepare_stage

        echo "--- Running All Test Shards ---"
        NUM_SHARDS=$(jq '.shard_count' "$SHARDS_FILE")
        FAIL=0
        for i in $(seq 0 $((NUM_SHARDS - 1))); do
            test_stage "$i" || FAIL=1
        done

        # The report stage should run regardless of test failure to report on the results.
        report_stage

        if [ "$FAIL" -eq 1 ]; then
            echo "❌ One or more test shards failed." >&2
            exit 1
        fi
        ;;
    *)
        echo "❌ ERROR: Unknown command '$COMMAND'." >&2
        exit 1
        ;;
esac