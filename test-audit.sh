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
E2E_TEST_TIMEOUT=300 # Increased to 5 minutes for more stability
MAX_SHARD_TIME=420

RUNTIME_FILE="./test-support/e2e-test-runtimes.json"
SHARDS_FILE="./test-support/e2e-shards.json"
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
        (timeout "$E2E_TEST_TIMEOUT"s pnpm exec playwright test "$TEST_FILE" --workers=1 --reporter=list > /dev/null 2>&1) || true
        END=$(date +%s)
        DURATION=$((END-START))
        TMP_JSON=$(mktemp)
        jq --arg test "$TEST_FILE" --argjson dur "$DURATION" '. + {($test): $dur}' "$RUNTIME_FILE" > "$TMP_JSON" && mv "$TMP_JSON" "$RUNTIME_FILE"
    done

    if [ ! -f "$RUNTIME_FILE" ]; then echo "❌ FATAL: E2E runtime file was not created." >&2; exit 1; fi

    echo "--- Auto-sharding E2E Tests ---"
    python3 -c "
import json
with open('$RUNTIME_FILE', 'r') as f: runtimes = json.load(f)
shards, c_shard, c_sum = [], [], 0
for test, dur in sorted(runtimes.items(), key=lambda x: x[1], reverse=True):
    if c_sum + dur > $MAX_SHARD_TIME and c_shard:
        shards.append(c_shard); c_shard, c_sum = [], 0
    c_shard.append(test); c_sum += dur
if c_shard: shards.append(c_shard)
with open('$SHARDS_FILE', 'w') as f: json.dump({'shards': shards, 'shard_count': len(shards)}, f, indent=2)
print(f'Shards written to $SHARDS_FILE')
"
    if [ ! -f "$SHARDS_FILE" ]; then echo "❌ FATAL: Shards file was not created." >&2; exit 1; fi
}

# ================================
# STAGE 2: Test
# ================================
test_stage() {
    SHARD_INDEX=$1
    echo "--- Running Test Stage for Shard $SHARD_INDEX ---"
    SHARD_TESTS=$(jq -r ".shards[$SHARD_INDEX][]" "$SHARDS_FILE")
    if [ -z "$SHARD_TESTS" ]; then echo "⚠️ No tests for shard $SHARD_INDEX."; return 0; fi

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

    jq -r '.suites[].suites[].specs[] | "\(.file) | \(.status) | \(.tests[0].results[0].duration / 1000)"' "$FINAL_MERGED_E2E_REPORT" | \
    sed 's/passed/✅ Passed/; s/failed/❌ Failed/; s/timedOut/❌ Timed Out/' | \
    awk -F '|' '{printf "| `%-45s` | %-12s | %-12s |\n", $1, $2, $3}' >> "$E2E_SUMMARY_REPORT"

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
        NUM_SHARDS=$(jq '.shard_count' "$SHARDS_FILE")
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