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
    pnpm exec dotenv -e .env.test -- pnpm build:test || {
        echo "❌ Build failed." >&2
        exit 1
    }
    echo "ℹ️ Build output located in ./frontend/dist"
    echo "✅ [3/5] Build Succeeded."
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
    pnpm exec playwright test tests/e2e --shard="${SHARD_NUM}/${TOTAL_SHARDS}"

    echo "✅ E2E Test Shard ${SHARD_NUM} Passed."
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

run_lighthouse_ci() {
    echo "✅ [6/5] Running Lighthouse CI..."

    # Ensure build exists
    if [ ! -d "frontend/dist" ]; then
        echo "📦 Building for Lighthouse..."
        pnpm build:test
    fi

    # Start preview server in background
    echo "🚀 Starting preview server..."
    # Use a specific port to avoid conflicts if needed, but default 4173 is standard
    pnpm preview &
    PREVIEW_PID=$!

    # Wait for server to be ready
    echo "⏳ Waiting for preview server..."
    if ! npx wait-on http://localhost:4173 --timeout 30000; then
        echo "❌ Preview server failed to start." >&2
        kill $PREVIEW_PID || true
        exit 1
    fi

    # Run Lighthouse
    echo "🔦 Running lhci autorun..."
    # Capture exit code to ensure cleanup
    set +e
    npx lhci autorun
    EXIT_CODE=$?
    set -e

    # Cleanup
    kill $PREVIEW_PID || true

    if [ $EXIT_CODE -ne 0 ]; then
        echo "❌ Lighthouse CI failed." >&2
        exit $EXIT_CODE
    fi

    echo "✅ [6/5] Lighthouse CI Passed."
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
        pnpm exec playwright merge-reports --reporter json,html blob-report > test-results/playwright/results.json
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
