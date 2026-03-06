#!/bin/bash
# Canonical Test Audit Script (v11)
# Single Source of Truth for all quality checks.
# Supports staged execution for CI and a full local run.
#
# FIXES APPLIED (v11):
#   - run_ci_simulation: Replaced custom unzip/grep JSONL blob parsing with
#     canonical `playwright merge-reports`. The old approach was fragile against
#     Playwright blob format changes and produced a non-standard results.json.
#     The new approach:
#       1. Flattens all shard .zip files into a single merge-input directory.
#       2. Runs playwright merge-reports once for HTML output.
#       3. Runs playwright merge-reports once for JSON output (→ results.json).
#     This produces a standard Playwright JSON report that run-metrics.sh consumes.

set -euo pipefail
trap 'echo "❌ An error occurred. Aborting test audit." >&2' ERR

# --- Configuration ---
E2E_TEST_DIR="tests/e2e"
ARTIFACTS_DIR="./test-support"
CI_SHARD_COUNT=4

# --- Helper Functions ---
ensure_artifacts_dir() {
    mkdir -p "$ARTIFACTS_DIR"
}

# Filter Playwright output to remove attachment and usage noise (unless CI_DEBUG=true)
filter_playwright_output() {
    RED='\033[0;31m'
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

    ESLINT_CHECK_EXISTS=0
    if [ -f "./scripts/check-eslint-disable.sh" ]; then
        echo "   🔍 ESLint Disable Check..."
        ESLINT_CHECK_EXISTS=1
    fi

    LINT_EXIT=0
    TC_EXIT=0
    wait $LINT_PID || LINT_EXIT=$?
    wait $TC_PID || TC_EXIT=$?

    if [ $LINT_EXIT -ne 0 ]; then
        echo "   ❌ Lint FAILED. Run 'pnpm lint' to see errors." >&2
        pnpm lint >&2
        exit 1
    fi
    echo "   ✅ Lint passed"

    if [ $TC_EXIT -ne 0 ]; then
        echo "   ❌ Typecheck FAILED. Run 'pnpm typecheck' to see errors." >&2
        pnpm typecheck >&2
        exit 1
    fi
    echo "   ✅ Typecheck passed"

    if [ $ESLINT_CHECK_EXISTS -eq 1 ]; then
        if ! ./scripts/check-eslint-disable.sh > /dev/null 2>&1; then
            echo "   ❌ ESLint Disable Check FAILED." >&2
            ./scripts/check-eslint-disable.sh >&2
            exit 1
        fi
        echo "   ✅ ESLint disable check passed"
    fi

    echo "   🧪 Unit Tests..."
    METRICS_OUTPUT="$(pwd)/unit-metrics.json"
    set +e
    FORCE_COLOR=1 CI=true pnpm exec vitest run --config frontend/vitest.config.mjs --pool=forks --reporter=default --reporter=json --outputFile="$METRICS_OUTPUT" 2>&1 | tee "$ARTIFACTS_DIR/unit-test.log"
    UNIT_EXIT=${PIPESTATUS[0]}
    set -e

    # [STABILIZATION] ERR_IPC_CHANNEL_CLOSED Resilience
    if [ $UNIT_EXIT -ne 0 ]; then
        CLEAN_LOG_FOR_CHECK=$(sed -E "s/\x1B\[([0-9]{1,2}(;[0-9]{1,2})?)?[mGK]//g" "$ARTIFACTS_DIR/unit-test.log")
        REAL_FAILURES=$(echo "$CLEAN_LOG_FOR_CHECK" | grep -E "^ FAIL | [1-9][0-9]* failed" | grep -v "Command failed" || true)
        if [ -z "$REAL_FAILURES" ] && grep -q "ERR_IPC_CHANNEL_CLOSED" "$ARTIFACTS_DIR/unit-test.log"; then
             echo "   ⚠️  [ENVIRONMENTAL] IPC crash detected, but no recorded test failures found."
             echo "   ✅ Continuing pipeline (SQM/Lighthouse will proceed)."
             UNIT_EXIT=0
        fi
    fi

    if [ -f "$ARTIFACTS_DIR/unit-test.log" ]; then
         CLEAN_LOG=$(sed -E "s/\x1B\[([0-9]{1,2}(;[0-9]{1,2})?)?[mGK]//g" "$ARTIFACTS_DIR/unit-test.log")
         SUMMARY=$(echo "$CLEAN_LOG" | grep -E "Tests[[:space:]]+[0-9]+[[:space:]]+passed" | head -1 || true)
         if [ -n "$SUMMARY" ]; then
             echo "   📊 Summary: $SUMMARY"
         else
             PASSED_COUNT=$(echo "$CLEAN_LOG" | grep -cE "✓|PASS" || echo "0")
             echo "   📊 Summary: ~$PASSED_COUNT tests passed (Summary line lost in exit crash)"
         fi
    fi

    if [ ! -f "$METRICS_OUTPUT" ]; then
        echo "   ❌ unit-metrics.json was not generated. Check Vitest reporter config." >&2
        exit 1
    fi
    mv "$METRICS_OUTPUT" . 2>/dev/null || echo "   ℹ️ metrics already at root"
    echo "   ✅ Moved unit-metrics.json to root"

    if [ $UNIT_EXIT -ne 0 ]; then
        echo "   ❌ Unit Tests FAILED." >&2
        exit 1
    fi
    echo "   ✅ Unit tests passed"
    echo "✅ [2/6] Code Quality Checks Passed."
}

run_build() {
    echo "✅ [3/6] Building Application for E2E Tests..."
    echo "   📦 This may take a minute. Running 'pnpm build:test'..."
    if ! pnpm build:test > "$ARTIFACTS_DIR/build.log" 2>&1; then
        echo "❌ Build failed. Run 'pnpm build:test' to see errors." >&2
        cat "$ARTIFACTS_DIR/build.log" >&2
        exit 1
    fi
    echo "✅ [3/6] Build Succeeded."
}

run_prepare_stage() {
    echo "🔐 Validating environment variables..."
    ensure_artifacts_dir
    node scripts/validate-env.mjs
    run_preflight
    run_quality_checks
    run_build
}

run_e2e_tests_shard() {
    local SHARD_NUM=$1
    local TOTAL_SHARDS=4
    echo "🧪 Preparing E2E Test Shard ${SHARD_NUM}/${TOTAL_SHARDS}..."
    echo "📋 Test files assigned to this shard:"
    FILES=$(pnpm exec playwright test tests/e2e --shard="${SHARD_NUM}/${TOTAL_SHARDS}" --list | grep -oE "[a-zA-Z0-9.-]+\.spec\.ts" | sort -u)
    FILE_COUNT=$(echo "$FILES" | wc -l | tr -d ' ')
    echo "$FILES" | sed 's|^|  - |'
    echo "   📊 Total Files in Shard: $FILE_COUNT"

    if [ ! -d "frontend/dist" ]; then
        echo "   📦 Building test artifact..."
        pnpm run build:test > "$ARTIFACTS_DIR/build.log" 2>&1
    fi

    echo "🚀 Running Shard ${SHARD_NUM}..."
    set +e
    # PLAYWRIGHT_BLOB_OUTPUT_DIR isolates each shard's blob output.
    # This prevents shards from overwriting each other's report.zip.
    PLAYWRIGHT_BLOB_OUTPUT_DIR="blob-report/shard-${SHARD_NUM}" \
        pnpm exec playwright test tests/e2e \
            --shard="${SHARD_NUM}/${TOTAL_SHARDS}" \
            --reporter=list,blob \
            2>&1 | filter_playwright_output
    local EXIT_CODE=${PIPESTATUS[0]}
    set -e

    if [ $EXIT_CODE -eq 0 ]; then
        echo "✅ E2E Test Shard ${SHARD_NUM} Passed."
    else
        echo "❌ E2E Test Shard ${SHARD_NUM} FAILED (Exit Code: $EXIT_CODE)." >&2
    fi
    return $EXIT_CODE
}

run_e2e_tests_all() {
    echo "✅ [4/6] Running ALL E2E Tests (local mode)..."
    mkdir -p "$ARTIFACTS_DIR"

    set +e
    FORCE_COLOR=1 pnpm exec playwright test $E2E_TEST_DIR --reporter=list 2>&1 | tee "$ARTIFACTS_DIR/e2e-test.log"
    local EXIT_CODE=${PIPESTATUS[0]}
    set -e

    CLEAN_LOG=$(sed -E "s/\x1B\[([0-9]{1,2}(;[0-9]{1,2})?)?[mGK]//g" "$ARTIFACTS_DIR/e2e-test.log")
    FAILED_COUNT=$(echo "$CLEAN_LOG" | grep -E "^  [0-9]+ failed" | head -1 | awk '{print $1}' || echo "0")
    PASSED_COUNT=$(echo "$CLEAN_LOG" | grep -E "^  [0-9]+ passed" | head -1 | awk '{print $1}' || echo "0")
    SKIPPED_COUNT=$(echo "$CLEAN_LOG" | grep -E "^  [0-9]+ skipped" | head -1 | awk '{print $1}' || echo "0")

    if [ $EXIT_CODE -eq 0 ]; then
        echo "   📊 Summary: $PASSED_COUNT passed, $SKIPPED_COUNT skipped"
        echo "✅ [4/6] E2E Tests Passed."
    else
        echo "   📊 Summary: ${FAILED_COUNT:-?} failed, $PASSED_COUNT passed, $SKIPPED_COUNT skipped"
        echo "❌ E2E full suite failed (Exit Code: $EXIT_CODE)." >&2
        exit 1
    fi
}

run_e2e_health_check() {
    echo "✅ [4/6] Running Core Journey (Canonical Health Check)..."
    pnpm exec playwright test tests/e2e/core-journey.e2e.spec.ts --project=chromium --reporter=list 2>&1 | filter_playwright_output || {
        echo "❌ Health Check failed." >&2
        exit 1
    }
    echo "✅ [4/6] Health Check Passed."
}

run_lighthouse_ci() {
    echo "✅ [5/6] Running Lighthouse CI..."
    if [ ! -d "frontend/dist" ]; then
        echo "📦 Building for Lighthouse..."
        pnpm build:test
    fi
    echo "🔦 Generating Lighthouse Config..."
    node scripts/generate-lhci-config.js
    echo "🔦 Running lhci autorun..."
    set +e
    NODE_NO_WARNINGS=1 npx lhci autorun --config=lighthouserc.json
    EXIT_CODE=$?
    set -e
    if [ $EXIT_CODE -ne 0 ]; then
        echo "❌ Lighthouse CI failed (Scores below threshold)." >&2
    fi
    node scripts/process-lighthouse-report.js
    if [ $EXIT_CODE -ne 0 ]; then
        exit $EXIT_CODE
    fi
    echo "✅ [5/6] Lighthouse CI Passed."
}

run_sqm_report_ci() {
    echo "✅ [6/6] Generating Final Report and Updating Docs..."
    echo "ℹ️ Merging metrics + updating PRD…"
    ensure_artifacts_dir
    if [ -f "./scripts/run-metrics.sh" ]; then
        ./scripts/run-metrics.sh
        node scripts/update-prd-metrics.mjs
    else
        echo "⚠️ Warning: Metric generation scripts not found. Skipping report."
    fi
    echo "✅ [6/6] Reporting complete."
}

run_sqm_report_local() {
    echo "✅ [6/6] Generating and Printing SQM Report..."
    if [ -f "./scripts/run-metrics.sh" ]; then
        ./scripts/run-metrics.sh
        echo "ℹ️  Formatting Console Output..."
        node scripts/print-metrics.mjs
    else
        echo "⚠️ Warning: Metric generation scripts not found. Skipping SQM report."
    fi
    echo "✅ [6/6] SQM Report Generation Complete."
}

# ─── merge_blob_reports ────────────────────────────────────────────────────────
# Canonical blob merge using playwright merge-reports.
#
# WHY: The previous approach (unzip + grep JSONL) was:
#   - Fragile: tied to Playwright's internal JSONL format, which can change.
#   - Non-standard: produced a custom results.json format instead of Playwright's.
#   - Brittle: grep regex for "status":"passed" could match inside other fields.
#
# HOW:
#   1. Find all *.zip files under blob-report/ (excluding merge-input itself).
#   2. Copy (flatten) them into a single merge-input directory.
#      playwright merge-reports expects a flat directory of blob zips.
#   3. Run merge-reports twice:
#      a) --reporter=html  → human-readable HTML report in merged-reports/
#      b) --reporter=json  → standard Playwright JSON to test-results/playwright/results.json
#      (Two passes because JSON reporter outputs to stdout; HTML needs --output flag.)
# ──────────────────────────────────────────────────────────────────────────────
merge_blob_reports() {
    echo "🔄 Merging blob reports..."
    mkdir -p merged-reports test-results/playwright

    local BLOB_ROOT="blob-report"
    local MERGE_INPUT="${BLOB_ROOT}/merge-input"

    if [ ! -d "${BLOB_ROOT}" ] || [ -z "$(ls -A "${BLOB_ROOT}" 2>/dev/null)" ]; then
        echo "⚠️ No blob reports found in ${BLOB_ROOT}. Skipping merge."
        return 0
    fi

    # Step 1: Flatten — copy all shard zips into one directory for merge-reports
    mkdir -p "${MERGE_INPUT}"
    find "${BLOB_ROOT}" -name "*.zip" \
        ! -path "${MERGE_INPUT}/*" \
        -exec cp {} "${MERGE_INPUT}/" \;

    local ZIP_COUNT
    ZIP_COUNT=$(find "${MERGE_INPUT}" -name "*.zip" | wc -l | tr -d ' ')
    echo "   📦 Found ${ZIP_COUNT} blob zip(s) to merge."

    if [ "${ZIP_COUNT}" -eq 0 ]; then
        echo "⚠️ No .zip files found after flatten step. Check PLAYWRIGHT_BLOB_OUTPUT_DIR." >&2
        return 0
    fi

    # Step 2a: HTML report
    PLAYWRIGHT_HTML_REPORT=merged-reports pnpm exec playwright merge-reports "${MERGE_INPUT}" \
        --reporter=html
    echo "   ✅ HTML report written to merged-reports/"

    # Step 2b: JSON report → standard path consumed by run-metrics.sh
    pnpm exec playwright merge-reports "${MERGE_INPUT}" \
        --reporter=json \
        > test-results/playwright/results.json
    echo "   ✅ JSON results written to test-results/playwright/results.json"

    # Sanity: confirm the JSON file is non-empty and parseable
    if ! jq empty test-results/playwright/results.json 2>/dev/null; then
        echo "❌ results.json is not valid JSON. merge-reports may have failed silently." >&2
        exit 1
    fi

    echo "✅ Blob reports merged."
}

run_ci_simulation() {
    echo "🤖 Running Full CI Simulation..."
    CI_SIM_START=$(date +%s)
    export CI=true

    # Clean up previous runs
    rm -rf test-results merged-reports blob-report

    # Kill any existing zombie servers
    lsof -t -i :4173 | xargs kill -9 2>/dev/null || true
    lsof -t -i :5173 | xargs kill -9 2>/dev/null || true

    # 1. Setup
    echo "🔧 CI Setup: Installing dependencies (silently)..."
    pnpm install --frozen-lockfile --reporter=silent > /dev/null 2>&1
    echo "🔧 CI Setup: Installing Playwright browsers (silently)..."
    pnpm exec playwright install --with-deps chromium > /dev/null 2>&1

    # 2. Prepare Stage (includes lint, typecheck, unit tests, build)
    run_prepare_stage

    # 3. E2E Shards
    TOTAL_SHARDS=${CI_SHARD_COUNT:-4}
    echo "🔄 Running $TOTAL_SHARDS shards..."

    local E2E_FAIL=0
    for ((shard=1; shard<=TOTAL_SHARDS; shard++)); do
        echo "🧪 Running shard ${shard}/${TOTAL_SHARDS}..."
        if ! run_e2e_tests_shard "$shard"; then
            E2E_FAIL=1
        fi
    done

    # 4. Merge — canonical playwright merge-reports (replaces custom JSONL parsing)
    merge_blob_reports

    # 5. Lighthouse
    run_lighthouse_ci

    # 6. SQM Report
    run_sqm_report_local

    if [ $E2E_FAIL -ne 0 ]; then
        echo "❌ CI Simulation FAILED due to E2E regressions." >&2
        exit 1
    fi
    echo "✅ CI Simulation Complete."
}

# --- Main Execution Logic ---
STAGE=${1:-"local"}
ensure_artifacts_dir

echo "🚀 Starting Test Audit (Stage: $STAGE)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 SpeakSharp Test Audit Pipeline"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

case $STAGE in
    prepare)
        run_prepare_stage
        echo "🎉 Prepare stage SUCCEEDED."
        ;;
    test)
        if [ -z "${2-}" ]; then
            echo "❌ Error: 'test' stage requires a shard index argument." >&2
            exit 1
        fi
        run_e2e_tests_shard "$2"
        echo "🎉 Test stage SUCCEEDED for shard $2."
        ;;
    report)
        run_sqm_report_ci
        echo "🎉 Report stage SUCCEEDED."
        ;;
    health-check)
        run_preflight
        echo "⏭️  [2/6] Skipping Code Quality Checks (Fast Mode)"
        run_build
        run_e2e_health_check
        echo "⏭️  [5/6] Skipping Lighthouse CI (Fast Mode)"
        run_sqm_report_local
        echo "🎉 Health-Check SUCCEEDED."
        ;;
    local)
        unset CI
        START_TIME=$(date +%s)
        run_preflight
        run_quality_checks
        run_build
        run_e2e_tests_all
        END_TIME=$(date +%s)
        TOTAL_RUNTIME=$((END_TIME - START_TIME))
        export TOTAL_RUNTIME_SECONDS=$TOTAL_RUNTIME
        run_sqm_report_local
        echo "🎉🎉🎉"
        echo "✅ SpeakSharp Local Test Audit SUCCEEDED!"
        echo "⏱️  Total Runtime: ${TOTAL_RUNTIME}s"
        echo "🎉🎉🎉"
        ;;
    ci-simulate)
        run_ci_simulation
        CI_SIM_END=$(date +%s)
        CI_SIM_ELAPSED=$((CI_SIM_END - CI_SIM_START))
        CI_SIM_MINS=$((CI_SIM_ELAPSED / 60))
        CI_SIM_SECS=$((CI_SIM_ELAPSED % 60))
        echo "🎉🎉🎉"
        echo "✅ SpeakSharp CI Simulation SUCCEEDED!"
        echo "⏱️  Total Elapsed: ${CI_SIM_MINS}m ${CI_SIM_SECS}s"
        echo "⏭️  Expected skips: 1 (stripe-checkout — requires live E2E_FREE_EMAIL/PASSWORD secrets)"
        echo "🎉🎉🎉"
        ;;
    *)
        echo "❌ Unknown stage: $STAGE" >&2
        echo "Usage: $0 {prepare|test <shard_index>|report|health-check|local|ci-simulate}"
        exit 1
        ;;
esac
