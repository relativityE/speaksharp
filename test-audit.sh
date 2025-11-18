#!/bin/bash
# Canonical Test Audit Script (v9)
# Single Source of Truth for all quality checks.
# Supports staged execution for CI and a full local run.
set -euo pipefail
trap 'echo "❌ An error occurred. Aborting test audit." >&2' ERR

# --- Configuration ---
E2E_TEST_DIR="tests/e2e"
ARTIFACTS_DIR="./test-support"
# Define the number of parallel shards for CI.
# This should be tuned based on test suite size and CI runner specs.
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
    pnpm exec concurrently "pnpm lint" "pnpm typecheck" "pnpm test" || {
        echo "❌ Code Quality Checks failed." >&2
        exit 1
    }
    echo "✅ [2/5] Code Quality Checks Passed."
}

run_build() {
    echo "✅ [3/5] Building Application for E2E Tests..."
    pnpm build:test || {
        echo "❌ Build failed." >&2
        exit 1
    }
    echo "✅ [3/5] Build Succeeded."
}

run_e2e_sharding() {
    echo "✅ [4/5] Preparing E2E Test Shards..."
    ensure_artifacts_dir
    readarray -t E2E_TEST_FILES < <(find "$E2E_TEST_DIR" -name '*.spec.ts' -print | sort)
    local E2E_TEST_COUNT=${#E2E_TEST_FILES[@]}

    local SHARD_COUNT=0
    if [ "$E2E_TEST_COUNT" -gt 0 ]; then
        SHARD_COUNT=$CI_SHARD_COUNT
        # Don't create more shards than there are test files
        if [ "$E2E_TEST_COUNT" -lt "$CI_SHARD_COUNT" ]; then
            SHARD_COUNT=$E2E_TEST_COUNT
        fi
    fi

    echo "{\"shard_count\": ${SHARD_COUNT}}" > "$ARTIFACTS_DIR/e2e-shards.json"
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

    # Playwright uses 1-based indexing for shards, CI matrix is 0-based.
    local PLAYWRIGHT_SHARD_ID=$((SHARD_INDEX + 1))
    echo "✅ [4/4] Running E2E Test Shard ${PLAYWRIGHT_SHARD_ID} of ${SHARD_COUNT}..."
    pnpm exec playwright test --shard="${PLAYWRIGHT_SHARD_ID}/${SHARD_COUNT}" || {
        echo "❌ E2E Test Shard ${PLAYWRIGHT_SHARD_ID} failed." >&2
        exit 1
    }
    echo "✅ [4/4] E2E Test Shard ${PLAYWRIGHT_SHARD_ID} Passed."
}

run_e2e_tests_all() {
    echo "✅ [4/5] Running ALL E2E Tests (local mode)..."
    pnpm exec playwright test || {
        echo "❌ E2E full suite failed." >&2
        exit 1
    }
    echo "✅ [4/5] E2E Tests Passed."
}

run_e2e_health_check() {
    echo "✅ [4/5] Running E2E Health Check..."
    # The health check command is defined in package.json
    pnpm test:e2e:health || {
        echo "❌ E2E Health Check failed." >&2
        exit 1
    }
    echo "✅ [4/5] E2E Health Check Passed."
}

run_sqm_report_ci() {
    echo "✅ [5/5] Generating Final Report and Updating Docs..."
    ensure_artifacts_dir
    if [ -f "./run-metrics.sh" ]; then
        # In CI, we want to update the PRD.md file
        ./run-metrics.sh
        pnpm exec node scripts/update-prd-metrics.mjs
    else
        echo "⚠️ Warning: Metric generation scripts not found. Skipping report."
    fi
    echo "✅ [5/5] Reporting complete."
}

run_sqm_report_local() {
    echo "✅ [5/5] Generating and Printing SQM Report..."
    if [ -f "./run-metrics.sh" ]; then
        # In local mode, we print the summary to the console
        ./run-metrics.sh --json-output
    else
        echo "⚠️ Warning: Metric generation scripts not found. Skipping SQM report."
    fi
    echo "✅ [5/5] SQM Report Generation Complete."
}


# --- Main Execution Logic ---
STAGE=${1:-"local"} # Default to 'local' for interactive developer runs

echo "🚀 Starting Test Audit (Stage: $STAGE)..."

case $STAGE in
    prepare)
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
    *)
        echo "❌ Unknown stage: $STAGE" >&2
        echo "Usage: $0 {prepare|test <shard_index>|report|health-check|local}"
        exit 1
        ;;
esac
