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
    echo "✅ [1/6] Running Preflight Checks..."
    ./scripts/preflight.sh
    echo "✅ [1/6] Preflight Checks Passed."
}

run_quality_checks() {
    echo "✅ [2/6] Running Code Quality Checks Sequentially..."
    
    echo "Running Lint..."
    if ! pnpm lint; then
        echo "❌ Lint failed." >&2
        exit 1
    fi

    echo "Running Typecheck..."
    if ! pnpm typecheck; then
        echo "❌ Typecheck failed." >&2
        exit 1
    fi

    echo "Running Unit Tests..."
    if ! pnpm test; then
        echo "❌ Unit Tests failed." >&2
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
    echo "✅ [2/6] Code Quality Checks Passed."
}

run_build() {
    echo "✅ [3/6] Building Application for E2E Tests..."
    pnpm build:test || {
        echo "❌ Build failed." >&2
        exit 1
    }
    echo "ℹ️ Build output located in ./frontend/dist"
    echo "✅ [3/6] Build Succeeded."
}



run_prepare_stage() {
    echo "🔐 Validating environment variables..."
    node scripts/validate-env.mjs
    run_preflight
    run_quality_checks
    run_build
}

run_e2e_tests_shard() {
    local SHARD_NUM=$1
    local TOTAL_SHARDS=4  # Fixed to match CI matrix

    echo "✅ Running E2E Test Shard ${SHARD_NUM}/${TOTAL_SHARDS}..."
    
    # Ensure build artifact exists (required for preview:test)
    if [ ! -d "frontend/dist" ]; then
        echo "📦 Building test artifact..."
        pnpm run build:test
    fi

    # Run Playwright with native sharding
    # Playwright expects 1-indexed shards
    # Use PLAYWRIGHT_BLOB_OUTPUT_DIR env var to output blobs to unique dir per shard
    PLAYWRIGHT_BLOB_OUTPUT_DIR="blob-report/shard-${SHARD_NUM}" \
        pnpm exec playwright test tests/e2e --shard="${SHARD_NUM}/${TOTAL_SHARDS}" --reporter=blob

    echo "✅ E2E Test Shard ${SHARD_NUM} Passed."
}

run_e2e_tests_all() {
    echo "✅ [4/6] Running ALL E2E Tests (local mode)..."
    pnpm exec playwright test $E2E_TEST_DIR || {
        echo "❌ E2E full suite failed." >&2
        exit 1
    }
    echo "✅ [4/6] E2E Tests Passed."
}

run_e2e_health_check() {
    echo "✅ [4/6] Running Core Journey (Canonical Health Check)..."
    pnpm exec playwright test tests/e2e/core-journey.e2e.spec.ts --project=chromium || {
        echo "❌ Health Check failed." >&2
        exit 1
    }
    echo "✅ [4/6] Health Check Passed."
}

run_lighthouse_ci() {
    echo "✅ [5/6] Running Lighthouse CI..."
    
    # Ensure build exists
    if [ ! -d "frontend/dist" ]; then
        echo "📦 Building for Lighthouse..."
        pnpm build:test
    fi
    
    # Run Lighthouse
    echo "🔦 Generating Lighthouse Config..."
    node scripts/generate-lhci-config.js
    
    echo "🔦 Running lhci autorun..."
    # Capture exit code to ensure cleanup
    set +e
    NODE_NO_WARNINGS=1 npx lhci autorun --config=lighthouserc.json
    EXIT_CODE=$?
    set -e
    
    if [ $EXIT_CODE -ne 0 ]; then
        echo "❌ Lighthouse CI failed (Scores below threshold)." >&2
        # We still want to print the scores if possible
    fi

    # Parse and print scores
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

run_ci_simulation() {
    echo "🤖 Running Full CI Simulation..."
    
    # Clean up previous runs
    rm -rf test-results merged-reports blob-report
    

    
    # 1. Setup (Match GitHub CI "prepare" job steps)
    echo "🔧 CI Setup: Installing dependencies..."
    pnpm install --frozen-lockfile
    
    echo "🔧 CI Setup: Installing Playwright browsers..."
    pnpm exec playwright install --with-deps chromium

    # 2. Run Prepare Stage
    run_prepare_stage
    
    # 3. Run Shards (Fixed to 4 like CI matrix)
    local TOTAL_SHARDS=4
    echo "🔄 Running $TOTAL_SHARDS shards..."
    
    for ((shard=1; shard<=TOTAL_SHARDS; shard++)); do
        echo "🧪 Running shard ${shard}/${TOTAL_SHARDS}..."
        run_e2e_tests_shard "$shard"
    done
    
    # 4. Merge reports if blob reports exist
    echo "🔄 Merging reports..."
    mkdir -p merged-reports test-results/playwright
    
    if [ -d "blob-report" ] && [ "$(ls -A blob-report 2>/dev/null)" ]; then
        # Count tests from each shard directory
        local total_passed=0
        local total_failed=0
        local total_skipped=0
        
        for shard_dir in blob-report/shard-*; do
            if [ -d "$shard_dir" ]; then
                # Look for the blob zip file in each shard directory
                for zip_file in "$shard_dir"/*.zip; do
                    if [ -f "$zip_file" ]; then
                        # Extract and count from report.jsonl (JSONL format)
                        # Count onTestEnd events by status (clean output with tr)
                        local passed_raw=$(unzip -p "$zip_file" report.jsonl 2>/dev/null | grep -c '"method":"onTestEnd".*"status":"passed"' 2>/dev/null | tr -d '[:space:]')
                        local failed_raw=$(unzip -p "$zip_file" report.jsonl 2>/dev/null | grep -c '"method":"onTestEnd".*"status":"failed"' 2>/dev/null | tr -d '[:space:]')
                        local skipped_raw=$(unzip -p "$zip_file" report.jsonl 2>/dev/null | grep -c '"method":"onTestEnd".*"status":"skipped"' 2>/dev/null | tr -d '[:space:]')
                        # Default to 0 if empty
                        local passed=${passed_raw:-0}
                        local failed=${failed_raw:-0}
                        local skipped=${skipped_raw:-0}
                        total_passed=$((total_passed + passed))
                        total_failed=$((total_failed + failed))
                        total_skipped=$((total_skipped + skipped))
                        echo "  📊 Shard $(basename $shard_dir): $passed passed, $failed failed, $skipped skipped"
                    fi
                done
            fi
        done
        
        echo "  📊 Total: $total_passed passed, $total_failed failed, $total_skipped skipped"
        
        # Create the aggregated JSON for metrics
        echo "{\"stats\": {\"expected\": $total_passed, \"unexpected\": $total_failed, \"skipped\": $total_skipped}}" > test-results/playwright/results.json
        echo "✅ Merged reports."
    else
        echo "⚠️ No blob reports to merge."
    fi
    
    # 5. Lighthouse
    run_lighthouse_ci
    
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
        # Unset CI to ensure local-friendly behaviors (e.g., JSON reporter, non-fatal E2E check)
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
