#!/bin/bash
# Canonical Test Audit Script (v13)
# Single Source of Truth for all quality checks.
# Supports staged execution for CI and a full local run.
#
# IMPROVEMENTS (v13):
#   - Sequential Stability: Local simulation runs shards one-by-one to avoid 
#     port/resource contention and false negatives on a single machine.
#   - Real-time Output: Streams Playwright logs directly to stdout so 
#     progress is visible and "not broken."
#   - Native Shard Isolation: (Kept from v12) Unique zips in blob-report/.
#   - Workspace Hygiene: Trap (EXIT) cleans ephemeral JSON metadata.
#   - Cleanup: Dedicated 'clean' command for manual artifact purging.

set -euo pipefail
trap 'cleanup_temp' EXIT

# --- Configuration ---
E2E_TEST_DIR="tests/e2e"
ARTIFACTS_DIR="./test-support"
CI_SHARD_COUNT=4
SKIP_LH=false

# --- Preflight ---
check_dependencies() {
    command -v jq >/dev/null 2>&1 || { echo "❌ Error: 'jq' is required but not installed." >&2; exit 1; }
    command -v unzip >/dev/null 2>&1 || { echo "❌ Error: 'unzip' is required but not installed." >&2; exit 1; }
}

# --- Helper Functions ---
ensure_artifacts_dir() {
    mkdir -p "$ARTIFACTS_DIR"
}

cleanup_temp() {
    # Only delete ephemeral metadata; keep standard folders defined in .gitignore
    rm -f "unit-metrics.json" "test-results/metrics.json" 2>/dev/null || true
    rm -rf "merge-input" 2>/dev/null || true
}

# Filter Playwright output to remove noise
filter_playwright_output() {
    RED_BOLD='\033[1;31m'
    YELLOW_BOLD='\033[1;33m'
    RESET='\033[0m'

    if [ "${CI_DEBUG:-false}" = "true" ]; then
        cat
    else
        grep --line-buffered -vE "^\s+attachment #[0-9]+:|Usage:|pnpm exec playwright show-trace|^\s+test-results/playwright/.*|^\s*──+|^\s*──+$|useUsageLimit.*FunctionsFetchError" | \
        sed -u -E 's/^.*\[(chromium|firefox|webkit|mobile).*\] › //' | \
        sed -u -E 's/:[0-9]+:[0-9]+ › / › /g' | \
        sed -u "s/FAILED/${RED_BOLD}FAILED${RESET}/g" | \
        sed -u "s/ERROR/${RED_BOLD}ERROR${RESET}/g" | \
        sed -u "s/FAILURE/${RED_BOLD}FAILURE${RESET}/g" | \
        sed -u "s/WARNING/${YELLOW_BOLD}WARNING${RESET}/g" | \
        sed -u "s/WARN/${YELLOW_BOLD}WARN${RESET}/g" || true
    fi
}

# --- Stage Functions ---
run_preflight() {
    echo "✅ [1/6] Running Preflight Checks..."
    check_dependencies
    ./scripts/preflight.sh
    echo "✅ [1/6] Preflight Checks Passed."
}

run_quality_checks() {
    echo "✅ [2/6] Run Code Quality Checks..."
    echo "   🔍 Lint..."
    pnpm lint --quiet > /dev/null 2>&1 &
    LINT_PID=$!
    echo "   🔍 Typecheck..."
    pnpm typecheck > /dev/null 2>&1 &
    TC_PID=$!

    LINT_EXIT=0
    TC_EXIT=0
    wait $LINT_PID || LINT_EXIT=$?
    wait $TC_PID || TC_EXIT=$?

    if [ $LINT_EXIT -ne 0 ]; then
        echo "   ❌ Lint FAILED." >&2
        exit 1
    fi
    echo "   ✅ Lint passed"

    if [ $TC_EXIT -ne 0 ]; then
        echo "   ❌ Typecheck FAILED." >&2
        exit 1
    fi
    echo "   ✅ Typecheck passed"

    echo "   🧪 Unit Tests..."
    METRICS_OUTPUT="$(pwd)/unit-metrics.json"
    set +e
    FORCE_COLOR=1 CI=true pnpm exec vitest run --config frontend/vitest.config.mjs --pool=forks --coverage --reporter=default --reporter=json --outputFile="$METRICS_OUTPUT" 2>&1 | tee "$ARTIFACTS_DIR/unit-test.log"
    UNIT_EXIT=${PIPESTATUS[0]}
    set -e

    if [ $UNIT_EXIT -ne 0 ]; then
        echo "   ❌ Unit Tests FAILED." >&2
        exit 1
    fi
    echo "   ✅ [2/6] Code Quality Checks Passed."
}

run_build() {
    echo "✅ [3/6] Building Application for E2E Tests..."
    if ! pnpm build:test > "$ARTIFACTS_DIR/build.log" 2>&1; then
        echo "❌ Build failed." >&2
        exit 1
    fi
    echo "✅ [3/6] Build Succeeded."
}

run_e2e_tests_shard() {
    local SHARD_NUM=$1
    local TOTAL_SHARDS=$2
    
    # STRUCTURAL FIX: Unique zip filename per shard in blob-report/
    # STREAMING: No file redirection here, allows user to see real-time output.
    PLAYWRIGHT_BLOB_OUTPUT_FILE="blob-report/report-shard-${SHARD_NUM}.zip" \
        pnpm exec playwright test tests/e2e \
            --shard="${SHARD_NUM}/${TOTAL_SHARDS}" \
            --reporter=blob,line \
            2>&1 | filter_playwright_output
    return ${PIPESTATUS[0]}
}

print_shard_summary() {
    local BLOB_ROOT="blob-report"
    local RESULTS_FILE="test-results/playwright/results.json"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📊 E2E Shard Results Summary"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    shopt -s nullglob
    for zip_file in "${BLOB_ROOT}"/report-shard-*.zip; do
        shard_id=$(basename "$zip_file" | sed -E 's/report-shard-([0-9]+)\.zip/\1/')
        
        p=$(unzip -p "$zip_file" report.jsonl 2>/dev/null | grep -c '"status":"passed"' || echo 0)
        f=$(unzip -p "$zip_file" report.jsonl 2>/dev/null | grep -c '"status":"failed"' || echo 0)
        s=$(unzip -p "$zip_file" report.jsonl 2>/dev/null | grep -c '"status":"skipped"' || echo 0)
        
        passed=$((10#$(echo "$p" | tr -dc '0-9')))
        failed=$((10#$(echo "$f" | tr -dc '0-9')))
        skipped=$((10#$(echo "$s" | tr -dc '0-9')))
        total=$((passed + failed + skipped))

        icon="✅"
        [ "$failed" -gt 0 ] && icon="❌"

        if [ "$skipped" -gt 0 ]; then
            printf "  %s Shard %-2s  %d / %d passed  (%d skipped)\n" "$icon" "$shard_id" "$passed" "$total" "$skipped"
        else
            printf "  %s Shard %-2s  %d / %d passed\n" "$icon" "$shard_id" "$passed" "$total"
        fi
    done

    if [ -f "$RESULTS_FILE" ]; then
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        g_p=$(jq '.stats.expected // 0' "$RESULTS_FILE")
        g_f=$(jq '.stats.unexpected // 0' "$RESULTS_FILE")
        g_s=$(jq '.stats.skipped // 0' "$RESULTS_FILE")
        g_k=$(jq '.stats.flaky // 0' "$RESULTS_FILE")
        g_t=$((g_p + g_f + g_s + g_k))
        
        printf "  ✅ Total Passed:  %d\n" "$g_p"
        [ "$g_f" -gt 0 ] && printf "  ❌ Total Failed:  %d\n" "$g_f"
        [ "$g_s" -gt 0 ] && printf "  ⏩ Total Skipped: %d\n" "$g_s"
        [ "$g_k" -gt 0 ] && printf "  ⚠️  Total Flaky:   %d\n" "$g_k"
        printf "  📊 Total Tests:   %d\n" "$g_t"
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

merge_blob_reports() {
    local BLOB_ROOT="blob-report"
    echo "🔄 Merging blob reports..."
    PLAYWRIGHT_HTML_REPORT=merged-reports pnpm exec playwright merge-reports "${BLOB_ROOT}" --reporter=html > /dev/null 2>&1
    mkdir -p test-results/playwright
    pnpm exec playwright merge-reports "${BLOB_ROOT}" --reporter=json > test-results/playwright/results.json 2>/dev/null
}

run_lighthouse_ci() {
    if [ "$SKIP_LH" = true ]; then
        echo "⏭️  [5/6] Skipping Lighthouse CI."
        return 0
    fi
    echo "✅ [5/6] Running Lighthouse CI..."
    node scripts/generate-lhci-config.js
    NODE_NO_WARNINGS=1 npx lhci autorun --config=lighthouserc.json > /dev/null 2>&1
    node scripts/process-lighthouse-report.js
    echo "✅ [5/6] Lighthouse CI Passed."
}

run_sqm_report_local() {
    echo "✅ [6/6] Generating SQM Metrics..."
    [ -f "./scripts/run-metrics.sh" ] && ./scripts/run-metrics.sh > /dev/null 2>&1
    node scripts/print-metrics.mjs
}

run_ci_simulation() {
    echo "🤖 Running Full CI Simulation (Version: v13)"
    export CI=true
    START_TIME=$(date +%s)

    rm -rf test-results/* merged-reports/* blob-report/* "$ARTIFACTS_DIR"/* 2>/dev/null || true
    mkdir -p test-results merged-reports blob-report "$ARTIFACTS_DIR"

    run_preflight
    run_quality_checks
    run_build

    echo "🧪 Running ${CI_SHARD_COUNT} shards SEQUENTIALLY for stability..."
    E2E_FAIL=0
    for ((shard=1; shard<=CI_SHARD_COUNT; shard++)); do
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🚀 Starting Shard ${shard}/${CI_SHARD_COUNT}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        run_e2e_tests_shard "$shard" "$CI_SHARD_COUNT" || E2E_FAIL=1
    done

    merge_blob_reports
    print_shard_summary
    run_lighthouse_ci
    run_sqm_report_local

    END_TIME=$(date +%s)
    printf "\n✅ CI Simulation Complete! (%dm %ds)\n" $(( (END_TIME-START_TIME)/60 )) $(( (END_TIME-START_TIME)%60 ))
    [ $E2E_FAIL -eq 0 ] || exit 1
}

show_help() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  ci-simulate           Run the full CI pipeline simulation (Preflight -> Quality -> Build -> E2E -> SQM)"
    echo "  local                 Run the full local audit (sequential E2E for stability)"
    echo "  agent                 Run the Agent-safe repair loop (Unit + Int + Core E2E)"
    echo "  clean                 Remove test artifacts, reports, and temporary metadata"
    echo ""
    echo "Options:"
    echo "  --skip-lighthouse     (ci-simulate|local) Skip the Lighthouse CI stage for faster local runs"
    echo "  --nuclear             (clean) Kill Vite/Playwright processes and wipe all dev/test caches"
    echo "  --help, -h            Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 ci-simulate --skip-lighthouse"
    echo "  $0 agent"
    echo "  $0 clean --nuclear"
}

# --- Summary ---
generate_summary_json() {
    local RESULTS_FILE="test-results/playwright/results.json"
    local SUMMARY_FILE="test-results/summary.json"
    mkdir -p test-results
    
    local passed=0 failed=0 skipped=0 flaky=0 total=0 status="pass"
    
    if [ -f "$RESULTS_FILE" ]; then
        passed=$(jq '.stats.expected // 0' "$RESULTS_FILE")
        failed=$(jq '.stats.unexpected // 0' "$RESULTS_FILE")
        skipped=$(jq '.stats.skipped // 0' "$RESULTS_FILE")
        flaky=$(jq '.stats.flaky // 0' "$RESULTS_FILE")
        total=$((passed + failed + skipped + flaky))
        [ "$failed" -gt 0 ] && status="fail"
    fi
    
    cat > "$SUMMARY_FILE" <<EOF
{
  "status": "$status",
  "passed": $passed,
  "failed": $failed,
  "skipped": $skipped,
  "flaky": $flaky,
  "total": $total,
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
    echo "📑 Machine-readable summary generated: $SUMMARY_FILE"
}

# --- Main ---
STAGE="local"
if [ $# -eq 0 ]; then show_help; exit 1; fi

for arg in "$@"; do
    if [ "$arg" = "--skip-lighthouse" ]; then SKIP_LH=true; fi
    if [ "$arg" = "ci-simulate" ]; then STAGE="ci-simulate"; fi
    if [ "$arg" = "agent" ]; then STAGE="agent"; fi
    if [ "$arg" = "local" ]; then STAGE="local"; fi
    if [ "$arg" = "clean" ]; then STAGE="clean"; fi
    if [ "$arg" = "--help" ] || [ "$arg" = "-h" ]; then show_help; exit 0; fi
done

case $STAGE in
    ci-simulate|local) 
        run_ci_simulation
        generate_summary_json
        ;;
    agent)
        echo "🤖 Running Agent Repair Loop (Deterministic Mode)..."
        export CI=true
        run_preflight
        run_quality_checks
        mkdir -p test-results/playwright
        # Core Journey only (no shards) - using canonical env var for output path
        PLAYWRIGHT_JSON_OUTPUT_NAME="test-results/playwright/results.json" \
            pnpm exec playwright test tests/e2e/core-journey.e2e.spec.ts --reporter=json > /dev/null 2>&1 || true
        generate_summary_json
        ;;
    clean) 
        NUCLEAR=false
        for subarg in "$@"; do if [ "$subarg" = "--nuclear" ]; then NUCLEAR=true; fi; done

        if [ "$NUCLEAR" = true ]; then
            echo "☢️  NUCLEAR CLEAN - Wiping all caches and killing processes..."Add
            pkill -f vite || true
            pkill -f playwright || true
            rm -rf frontend/dist frontend/node_modules/.vite frontend/.vite node_modules/.cache 2>/dev/null || true
        fi

        echo "🧹 Cleaning CI & Test artifacts..."
        # Sync'd with v14 .gitignore hardening
        rm -rf test-results/ merged-reports/ blob-report/ playwright-report/ 2>/dev/null || true
        rm -rf lighthouse-results/ .lighthouseci/ screenshots/ coverage/ html/ 2>/dev/null || true
        rm -rf test-support/ blob-collection/ playwright-results.json/ 2>/dev/null || true
        rm -f *-metrics.json results.json lighthouse-*.json 2>/dev/null || true
        echo "✅ Clean complete."
        ;;
    *) 
        echo "Usage: $0 ci-simulate [--skip-lighthouse] | clean [--nuclear]"
        echo ""
        echo "Commands:"
        echo "  ci-simulate   Run full CI pipeline simulation"
        echo "  clean         Remove test artifacts and reports"
        echo "  clean --nuclear  Kill processes and wipe all dev/test caches"
        exit 1 ;;
esac
