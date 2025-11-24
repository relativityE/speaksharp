#!/bin/bash
# Canonical Test Audit Script (v10)
# Single Source of Truth for all quality checks.
# Supports staged execution for CI and a full local run.
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

# --- Stage Functions ---

run_preflight() {
    echo "✅ [1/5] Running Preflight Checks..."
    ./scripts/preflight.sh
    echo "✅ [1/5] Preflight Checks Passed."
}

run_quality_checks() {
    echo "✅ [2/5] Running Code Quality Checks in Parallel..."
    if ! pnpm exec concurrently --kill-others-on-fail "pnpm lint" "pnpm typecheck" "pnpm test"; then
        echo "❌ Code Quality Checks failed." >&2
        exit 1
    fi
    
    # Move metrics file to root for CI artifact upload
    if [ -f "frontend/unit-metrics.json" ]; then
        mv frontend/unit-metrics.json .
        echo "ℹ️ Moved unit-metrics.json to root."
    else
        echo "⚠️ Warning: frontend/unit-metrics.json not found."
    fi
    
    echo "ℹ️ Lint/Typecheck/Test completed successfully."
    echo "✅ [2/5] Code Quality Checks Passed."
}

run_build() {
    echo "✅ [3/5] Building Application for E2E Tests..."
    pnpm build:test || {
        echo "❌ Build failed." >&2
        exit 1
    }
    echo "ℹ️ Build output located in ./frontend/dist"
    echo "✅ [3/5] Build Succeeded."
}

run_e2e_sharding() {
    echo "✅ [4/5] Preparing E2E Test Shards..."
    ensure_artifacts_dir
    
    # Use mapfile if available, otherwise fall back to read loop
    local E2E_TEST_FILES=()
    while IFS= read -r file; do
        E2E_TEST_FILES+=("$file")
    done < <(find "$E2E_TEST_DIR" -name '*.spec.ts' -print | sort)
    
    local E2E_TEST_COUNT=${#E2E_TEST_FILES[@]}

    local SHARD_COUNT=0
    if [ "$E2E_TEST_COUNT" -gt 0 ]; then
        SHARD_COUNT=$CI_SHARD_COUNT
        if [ "$E2E_TEST_COUNT" -lt "$CI_SHARD_COUNT" ]; then
            SHARD_COUNT=$E2E_TEST_COUNT
        fi
    fi

    echo "{\"shard_count\": ${SHARD_COUNT}}" > "$ARTIFACTS_DIR/e2e-shards.json"
    echo "ℹ️ Shard file written to $ARTIFACTS_DIR/e2e-shards.json"
    cat "$ARTIFACTS_DIR/e2e-shards.json"
    echo "📋 Found ${E2E_TEST_COUNT} E2E tests. Prepared ${SHARD_COUNT} shards for CI."
    echo "✅ [4/5] E2E sharding complete."
}

run_e2e_tests_shard() {
    local SHARD_INDEX=$1
    local SHARD_COUNT
    SHARD_COUNT=$(jq '.shard_count' "$ARTIFACTS_DIR/e2e-shards.json")

    if [ "$SHARD_COUNT" -eq 0 ]; then
        echo "🤷 No E2E test shards to run. Skipping."
        return
    fi

    local PLAYWRIGHT_SHARD_ID=$((SHARD_INDEX + 1))
    # Use a separate directory for shards to avoid Playwright cleaning it up
    local REPORT_DIR="test-results/shards/shard-${SHARD_INDEX}"
    mkdir -p "$REPORT_DIR"

    echo "✅ Running E2E Test Shard ${PLAYWRIGHT_SHARD_ID}/${SHARD_COUNT}..."
    
    # Ensure build artifact exists (required for preview:test)
    if [ ! -d "frontend/dist" ]; then
        echo "📦 Building test artifact..."
        pnpm run build:test
    fi

    # Run Playwright shard
    # We use set +e to capture the exit code so we can move artifacts even on failure
    set +e
    pnpm exec playwright test $E2E_TEST_DIR \
        --shard="${PLAYWRIGHT_SHARD_ID}/${SHARD_COUNT}"
    EXIT_CODE=$?
    set -e

    # Move blob reports (if any) to the report dir
    # Default blob report dir is blob-report
    if [ -d "blob-report" ]; then
        echo "📦 Moving blob reports to $REPORT_DIR"
        # Ensure directory exists (it should, but just in case)
        mkdir -p "$REPORT_DIR"
        mv blob-report/* "$REPORT_DIR"
        rmdir blob-report
    fi

    if [ $EXIT_CODE -ne 0 ]; then
        echo "❌ E2E Test Shard ${PLAYWRIGHT_SHARD_ID} failed." >&2
        exit $EXIT_CODE
    fi

    echo "✅ E2E Test Shard ${PLAYWRIGHT_SHARD_ID} Passed."
}

run_e2e_tests_all() {
    echo "✅ [4/5] Running ALL E2E Tests (local mode)..."
    pnpm exec playwright test $E2E_TEST_DIR || {
        echo "❌ E2E full suite failed." >&2
        exit 1
    }
    echo "✅ [4/5] E2E Tests Passed."
}

run_e2e_health_check() {
    echo "✅ [4/5] Running E2E Health Check..."
    pnpm test:e2e:health || {
        echo "❌ E2E Health Check failed." >&2
        exit 1
    }
    echo "✅ [4/5] E2E Health Check Passed."
}

run_sqm_report_ci() {
    echo "✅ [5/5] Generating Final Report and Updating Docs..."
    echo "ℹ️ Merging metrics + updating PRD…"
    ensure_artifacts_dir
    if [ -f "./scripts/run-metrics.sh" ]; then
        ./scripts/run-metrics.sh
        pnpm exec node scripts/update-prd-metrics.mjs
    else
        echo "⚠️ Warning: Metric generation scripts not found. Skipping report."
    fi
    echo "✅ [5/5] Reporting complete."
}

run_sqm_report_local() {
    echo "✅ [5/5] Generating and Printing SQM Report..."
    if [ -f "./scripts/run-metrics.sh" ]; then
        ./scripts/run-metrics.sh --json-output
    else
        echo "⚠️ Warning: Metric generation scripts not found. Skipping SQM report."
    fi
    echo "✅ [5/5] SQM Report Generation Complete."
}

run_ci_simulation() {
    echo "🤖 Running Full CI Simulation..."
    
    # Clean up previous runs
    rm -rf test-results merged-reports blob-report
    
    # 1. Prepare
    run_preflight
    run_quality_checks
    run_build
    run_e2e_sharding
    
    # 2. Run Shards
    local SHARD_COUNT=$(jq '.shard_count' "$ARTIFACTS_DIR/e2e-shards.json")
    echo "🔄 Running $SHARD_COUNT shards..."
    
    for ((i=0; i<SHARD_COUNT; i++)); do
        # We need to set CI=true to force blob reporter if not already set
        CI=true run_e2e_tests_shard "$i"
    done
    
    # 3. Merge and Report
    echo "🔄 Merging reports..."
    mkdir -p merged-reports
    mkdir -p test-results/playwright
    
    # Find all blob reports in test-results/shards/shard-*
    # Note: In CI this is done by downloading artifacts. Here they are already in place.
    echo "🔍 Listing test-results/shards:"
    ls -R test-results/shards
    
    find test-results/shards -name 'report-*.zip' | while read report; do
        shard_name=$(basename $(dirname "$report"))
        echo "Copying $report to merged-reports/${shard_name}.zip"
        cp "$report" "merged-reports/${shard_name}.zip"
    done
    
    echo "🔍 Listing merged-reports:"
    ls -la merged-reports/
    
    if [ "$(ls -A merged-reports 2>/dev/null)" ]; then
        pnpm exec playwright merge-reports --reporter json,html merged-reports > test-results/playwright/results.json
        echo "✅ Merged reports."
    else
        echo "⚠️ No reports to merge."
    fi
    
    run_sqm_report_ci
    echo "✅ CI Simulation Complete."
}


# --- Main Execution Logic ---
STAGE=${1:-"local"}

echo "🚀 Starting Test Audit (Stage: $STAGE)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 SpeakSharp Test Audit Pipeline"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

case $STAGE in
    prepare)
        echo "🔐 Validating environment variables..."
        node scripts/validate-env.mjs
        run_preflight
        run_quality_checks
        run_build
        run_e2e_sharding
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
        run_quality_checks
        run_build
        run_e2e_health_check
        run_sqm_report_local
        echo "🎉 Health-Check SUCCEEDED."
        ;;
    local)
        run_preflight
        run_quality_checks
        run_build
        run_e2e_tests_all
        run_sqm_report_local
        echo "🎉🎉🎉"
        echo "✅ SpeakSharp Local Test Audit SUCCEEDED!"
        echo "🎉🎉🎉"
        ;;
    ci-simulate)
        run_ci_simulation
        echo "🎉🎉🎉"
        echo "✅ SpeakSharp CI Simulation SUCCEEDED!"
        echo "🎉🎉🎉"
        ;;
    *)
        echo "❌ Unknown stage: $STAGE" >&2
        echo "Usage: $0 {prepare|test <shard_index>|report|health-check|local}"
        exit 1
        ;;
esac
